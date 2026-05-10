// ============================================================
// AI Assistant — GitHub code-editing tools
//
// Lets the in-app assistant read/write any file in the repo via the
// GitHub Contents API. Each write_file is a real commit on `main`,
// which Cloudflare Pages auto-deploys within ~30 seconds.
//
// Auth: GITHUB_TOKEN env var (Cloudflare Pages secret), fine-grained
// PAT scoped to ethan8585g/roofreporter-ai-good-copy with
// Contents:read/write + Metadata:read.
// ============================================================
import type { D1Database } from '@cloudflare/workers-types'
import type { ToolDef } from './ai-assistant-tools'

const REPO_OWNER = 'ethan8585g'
const REPO_NAME = 'roofreporter-ai-good-copy'
const BRANCH = 'main'
const API_BASE = 'https://api.github.com'

// User-Agent is required by GitHub
const UA = 'roofmanager-ai-assistant'

export const GITHUB_TOOLS: ToolDef[] = [
  {
    name: 'list_files',
    description:
      'List files and directories at a given path in the repo. Pass "" or "/" for repo root. Returns name, path, type ("file"|"dir"), and size for each entry.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path. Empty string for root. Examples: "src", "src/services", "migrations".' },
      },
    },
  },
  {
    name: 'read_file',
    description:
      'Read the full text content of a file in the repo. Returns content as a string. Required before any write_file so you have the latest sha for optimistic concurrency.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path. Example: "src/services/report-engine.ts".' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write or overwrite a file in the repo. Commits to main. Cloudflare Pages auto-deploys within ~30 seconds. For existing files you MUST pass the sha returned by read_file (optimistic concurrency — the API rejects writes if the file changed since you read it). Omit sha to create a new file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path.' },
        content: { type: 'string', description: 'Full new file contents (UTF-8).' },
        message: { type: 'string', description: 'Commit message. Be specific — this shows up in git history forever.' },
        sha: { type: 'string', description: 'Required when overwriting an existing file. The blob SHA from read_file. Omit when creating a new file.' },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the repo. Commits to main. Pass the sha from read_file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        message: { type: 'string', description: 'Commit message.' },
        sha: { type: 'string', description: 'Blob SHA from read_file. Required.' },
      },
      required: ['path', 'message', 'sha'],
    },
  },
  {
    name: 'list_recent_commits',
    description: 'List the most recent commits on main with sha, message, author, date. Use this to see what the agent (or anyone) recently changed before deciding to revert.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max commits. Default 10, max 50.' },
      },
    },
  },
  {
    name: 'revert_commit',
    description: 'Revert a commit by creating a new commit that undoes its changes. Use this for one-click rollback if something the agent pushed broke production. Pass the SHA of the bad commit. The revert is itself a new commit on main.',
    input_schema: {
      type: 'object',
      properties: {
        sha: { type: 'string', description: 'SHA of the commit to revert.' },
      },
      required: ['sha'],
    },
  },
  {
    name: 'list_assistant_commits',
    description: 'List recent commits this AI assistant pushed (from the audit log). Helps you see what the assistant has been doing.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max rows. Default 20, max 100.' },
      },
    },
  },
]

export async function runGithubTool(
  token: string,
  db: D1Database,
  context: { userPrompt: string; model: string },
  name: string,
  input: any,
): Promise<any> {
  if (!token) return { error: 'GITHUB_TOKEN not configured. Add it as a Cloudflare Pages secret.' }
  switch (name) {
    case 'list_files': return listFiles(token, input?.path ?? '')
    case 'read_file': return readFile(token, input?.path)
    case 'write_file': return writeFile(token, db, context, input)
    case 'delete_file': return deleteFile(token, input)
    case 'list_recent_commits': return listRecentCommits(token, input?.limit)
    case 'revert_commit': return revertCommit(token, db, context, input?.sha)
    case 'list_assistant_commits': return listAssistantCommits(db, input?.limit)
    default: return { error: `Unknown tool: ${name}` }
  }
}

function ghHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
    'Content-Type': 'application/json',
  }
}

async function listFiles(token: string, path: string) {
  const safePath = (path || '').replace(/^\//, '')
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(safePath)}?ref=${BRANCH}`
  const res = await fetch(url, { headers: ghHeaders(token) })
  if (!res.ok) return { error: `GitHub ${res.status}: ${await res.text()}` }
  const data = await res.json() as any
  if (!Array.isArray(data)) return { error: 'Not a directory' }
  return {
    path: safePath || '/',
    entries: data.map((e: any) => ({ name: e.name, path: e.path, type: e.type, size: e.size })),
    count: data.length,
  }
}

async function readFile(token: string, path: string) {
  if (!path) return { error: 'path is required' }
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(path)}?ref=${BRANCH}`
  const res = await fetch(url, { headers: ghHeaders(token) })
  if (!res.ok) return { error: `GitHub ${res.status}: ${await res.text()}` }
  const data = await res.json() as any
  if (Array.isArray(data) || data.type !== 'file') return { error: 'Path is not a file' }
  // GitHub returns content as base64 with newlines. We decode as UTF-8 — naive
  // atob() returns a binary string where multibyte chars (em-dash, smart quotes,
  // anything non-ASCII) become mojibake. If we then wrote that back, we'd silently
  // corrupt every non-ASCII glyph in the file.
  const content = b64ToUtf8((data.content || '').replace(/\n/g, ''))
  if (looksBinary(content)) {
    return {
      path: data.path,
      sha: data.sha,
      size: data.size,
      content: null,
      binary: true,
      note: 'Binary file — content not returned. Use the sha to delete or rename, but do not attempt to read or rewrite as text.',
    }
  }
  return { path: data.path, sha: data.sha, size: data.size, content }
}

async function writeFile(
  token: string,
  db: D1Database,
  context: { userPrompt: string; model: string },
  input: any,
) {
  if (!input?.path || input?.content === undefined || !input?.message) {
    return { error: 'path, content, message are required' }
  }
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(input.path)}`
  const body: any = {
    message: input.message,
    branch: BRANCH,
    content: utf8ToB64(input.content),
  }
  if (input.sha) body.sha = input.sha
  const res = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 409 || /sha/i.test(err)) {
      return { error: `Stale sha — file changed since you read it. Re-read and retry. (${res.status}: ${err.slice(0, 200)})` }
    }
    return { error: `GitHub ${res.status}: ${err.slice(0, 400)}` }
  }
  const data = await res.json() as any
  const commitSha = data?.commit?.sha
  // Audit log
  try {
    await db.prepare(
      `INSERT INTO assistant_commits (sha, branch, file_paths, message, user_prompt, model)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      commitSha || 'unknown',
      BRANCH,
      JSON.stringify([input.path]),
      input.message,
      context.userPrompt.slice(0, 4000),
      context.model,
    ).run()
  } catch (e: any) {
    // Don't fail the write if logging fails — surface as a warning
    console.warn('[ai-assistant] audit log insert failed:', e?.message)
  }
  return {
    ok: true,
    path: data?.content?.path,
    sha: data?.content?.sha,
    commit_sha: commitSha,
    commit_url: data?.commit?.html_url,
    note: 'Cloudflare Pages will auto-deploy this commit within ~30 seconds.',
  }
}

async function deleteFile(token: string, input: any) {
  if (!input?.path || !input?.sha || !input?.message) {
    return { error: 'path, sha, message are required' }
  }
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(input.path)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: ghHeaders(token),
    body: JSON.stringify({ message: input.message, sha: input.sha, branch: BRANCH }),
  })
  if (!res.ok) return { error: `GitHub ${res.status}: ${await res.text()}` }
  const data = await res.json() as any
  return { ok: true, commit_sha: data?.commit?.sha, commit_url: data?.commit?.html_url }
}

async function listRecentCommits(token: string, limit?: number) {
  const max = Math.min(Math.max(1, Number(limit) || 10), 50)
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits?sha=${BRANCH}&per_page=${max}`
  const res = await fetch(url, { headers: ghHeaders(token) })
  if (!res.ok) return { error: `GitHub ${res.status}: ${await res.text()}` }
  const data = await res.json() as any[]
  return {
    commits: data.map((c) => ({
      sha: c.sha,
      short_sha: c.sha.slice(0, 7),
      message: c.commit?.message,
      author: c.commit?.author?.name,
      date: c.commit?.author?.date,
      url: c.html_url,
    })),
  }
}

async function revertCommit(
  token: string,
  db: D1Database,
  context: { userPrompt: string; model: string },
  sha: string,
) {
  if (!sha) return { error: 'sha is required' }
  // GitHub doesn't have a one-shot revert API. We synthesize one by:
  // 1. fetching the commit's parent
  // 2. fetching each file modified in the commit at the parent revision
  // 3. writing those parent contents back, in a single new commit per file
  // For a simpler MVP: we use the commit's diff to revert each touched file individually.
  const commitRes = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits/${sha}`,
    { headers: ghHeaders(token) },
  )
  if (!commitRes.ok) return { error: `Could not fetch commit ${sha}: ${await commitRes.text()}` }
  const commit = await commitRes.json() as any
  const parentSha = commit?.parents?.[0]?.sha
  if (!parentSha) return { error: 'Commit has no parent (initial commit?) — cannot revert.' }
  const files: any[] = commit.files || []
  if (!files.length) return { error: 'No files changed in that commit.' }

  const reverted: any[] = []
  for (const f of files) {
    // Fetch the file as it was at the parent commit
    const beforeRes = await fetch(
      `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(f.filename)}?ref=${parentSha}`,
      { headers: ghHeaders(token) },
    )
    // Get the current head sha for the file (so PUT doesn't 409)
    const headRes = await fetch(
      `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(f.filename)}?ref=${BRANCH}`,
      { headers: ghHeaders(token) },
    )
    if (!headRes.ok) {
      reverted.push({ path: f.filename, status: 'skipped', reason: `current state fetch failed: ${headRes.status}` })
      continue
    }
    const headData = await headRes.json() as any
    if (f.status === 'added') {
      // To revert an added file, delete it
      const delRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(f.filename)}`,
        {
          method: 'DELETE',
          headers: ghHeaders(token),
          body: JSON.stringify({
            message: `Revert ${sha.slice(0, 7)}: delete ${f.filename}`,
            sha: headData.sha,
            branch: BRANCH,
          }),
        },
      )
      reverted.push({
        path: f.filename,
        status: delRes.ok ? 'deleted' : 'error',
        sha: delRes.ok ? (await delRes.json() as any)?.commit?.sha : null,
      })
      continue
    }
    if (!beforeRes.ok) {
      reverted.push({ path: f.filename, status: 'skipped', reason: 'pre-revert content unavailable' })
      continue
    }
    const before = await beforeRes.json() as any
    const putRes = await fetch(
      `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(f.filename)}`,
      {
        method: 'PUT',
        headers: ghHeaders(token),
        body: JSON.stringify({
          message: `Revert ${sha.slice(0, 7)}: ${f.filename}`,
          content: before.content?.replace(/\n/g, ''),
          sha: headData.sha,
          branch: BRANCH,
        }),
      },
    )
    reverted.push({
      path: f.filename,
      status: putRes.ok ? 'reverted' : 'error',
      sha: putRes.ok ? (await putRes.json() as any)?.commit?.sha : null,
    })
  }
  // Audit log: mark the original commit as reverted
  try {
    await db.prepare(
      `UPDATE assistant_commits SET reverted = 1, reverted_by_sha = ? WHERE sha = ?`
    ).bind(reverted[reverted.length - 1]?.sha || 'unknown', sha).run()
  } catch (_) { /* ignore */ }
  return {
    ok: true,
    reverted_files: reverted,
    note: `Created ${reverted.filter(r => r.status === 'reverted' || r.status === 'deleted').length} revert commits. Cloudflare Pages will auto-deploy within ~30 seconds.`,
  }
}

async function listAssistantCommits(db: D1Database, limit?: number) {
  const max = Math.min(Math.max(1, Number(limit) || 20), 100)
  const result = await db.prepare(
    `SELECT id, sha, branch, file_paths, message, user_prompt, model, reverted, reverted_by_sha, created_at
     FROM assistant_commits ORDER BY created_at DESC LIMIT ?`
  ).bind(max).all()
  return { commits: result.results, count: result.results?.length ?? 0 }
}

// Encode a path for URL while preserving slashes
function encodeURIPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

// Decode a base64 string (as returned by the GitHub Contents API) into a real
// UTF-8 string. atob() alone returns binary where each char is a byte; we have
// to interpret those bytes as UTF-8 or non-ASCII glyphs come back as mojibake
// (em-dash â, smart quotes â, etc.).
function b64ToUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

// Encode a UTF-8 string as base64 for the GitHub Contents PUT body. The
// classic `btoa(unescape(encodeURIComponent(s)))` works but `unescape` is
// deprecated and chokes on certain code points; this version goes through
// TextEncoder explicitly.
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  // String.fromCharCode(...bytes) blows the stack on large inputs; chunk it.
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// Detect binary content so read_file doesn't return mangled text for images,
// PDFs, etc. Heuristic: a null byte or >5% non-printable in a sample.
function looksBinary(s: string): boolean {
  const sample = s.slice(0, 8192)
  if (sample.includes('\0')) return true
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c < 9 || (c > 13 && c < 32)) nonPrintable++
  }
  return nonPrintable / Math.max(sample.length, 1) > 0.05
}
