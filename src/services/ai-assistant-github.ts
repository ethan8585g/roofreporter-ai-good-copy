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
  {
    name: 'write_files',
    description:
      'Write multiple files in ONE atomic commit using the Git Trees API. Strongly preferred over multiple write_file calls when you are making a coherent multi-file change (refactor, multi-file feature, etc.) — produces a single commit, single deploy cycle, atomic rollback. Each file in the array gets created or overwritten. Pass full UTF-8 content. Cloudflare Pages auto-deploys the resulting commit. Pre-push validation runs on every file in the batch before any commit happens — if any file fails, NOTHING is committed.',
    input_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Array of file changes. Each entry: {path, content}. New files and overwrites both work — no sha needed at the batch level.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Repo-relative path.' },
              content: { type: 'string', description: 'Full UTF-8 file contents.' },
            },
            required: ['path', 'content'],
          },
        },
        message: { type: 'string', description: 'Single commit message for the whole batch.' },
      },
      required: ['files', 'message'],
    },
  },
  {
    name: 'search_code',
    description:
      'Search the repo for a substring or code pattern via the GitHub code search API. Returns matching files with surrounding line context. Use this when you need to find every reference to a function name, env var, route, etc. across the codebase.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query. Plain text or GitHub code-search syntax. Examples: "openHouse3D", "function calculateArea", "ANTHROPIC_API_KEY".' },
        limit: { type: 'integer', description: 'Max results. Default 20, max 50.' },
      },
      required: ['query'],
    },
  },
]

export async function runGithubTool(
  token: string,
  db: D1Database,
  context: {
    userPrompt: string
    model: string
    cloudflareApiToken?: string
    cloudflareAccountId?: string
    waitUntil?: (p: Promise<any>) => void
  },
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
    case 'write_files': return writeFiles(token, db, context, input)
    case 'search_code': return searchCode(token, input)
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
  context: {
    userPrompt: string
    model: string
    cloudflareApiToken?: string
    cloudflareAccountId?: string
    waitUntil?: (p: Promise<any>) => void
  },
  input: any,
) {
  if (!input?.path || input?.content === undefined || !input?.message) {
    return { error: 'path, content, message are required' }
  }
  // ── Pre-push validation ────────────────────────────────
  const validation = await validateWrite(token, input.path, input.content, context.userPrompt)
  if (!validation.ok) {
    return { error: `Pre-push validation failed: ${validation.error}`, validation_failed: true }
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
  // Kick off background deployment monitor (waitUntil keeps it running after we respond)
  let monitorNote = 'Cloudflare Pages will auto-deploy this commit within ~30 seconds.'
  if (commitSha && context.cloudflareApiToken && context.cloudflareAccountId) {
    const monitorPromise = monitorDeployment(
      token, db, context, commitSha, input.path,
    )
    if (context.waitUntil) {
      context.waitUntil(monitorPromise)
      monitorNote = `Pushed ${commitSha.slice(0, 7)}. Monitoring Cloudflare Pages build for ~90s — if it fails, this commit will be auto-reverted. Check list_assistant_commits to see the final outcome.`
    } else {
      // No waitUntil — fire-and-forget; result still lands in assistant_commits
      monitorPromise.catch((e) => console.warn('[ai-assistant] deployment monitor crashed:', e?.message))
      monitorNote = `Pushed ${commitSha.slice(0, 7)}. Build will be monitored in the background.`
    }
  }
  return {
    ok: true,
    path: data?.content?.path,
    sha: data?.content?.sha,
    commit_sha: commitSha,
    commit_url: data?.commit?.html_url,
    note: monitorNote,
  }
}

// ─── Post-push deployment monitor ────────────────────────────────────
// Polls Cloudflare Pages for the deployment of the commit we just pushed.
// If the build FAILS, auto-reverts the commit and logs the outcome to
// assistant_commits.reverted. If it succeeds, logs success. Either way the
// operator has a record. Runs in the background via ctx.waitUntil so the
// chat doesn't block.
const CF_PAGES_PROJECT = 'roofing-measurement-tool'
async function monitorDeployment(
  ghToken: string,
  db: D1Database,
  context: { cloudflareApiToken?: string; cloudflareAccountId?: string; userPrompt: string; model: string },
  commitSha: string,
  filePath: string,
): Promise<void> {
  if (!context.cloudflareApiToken || !context.cloudflareAccountId) return

  // Give Cloudflare ~12s to register the push and start a build
  await sleep(12_000)

  const shortSha = commitSha.slice(0, 7)
  const headers = {
    Authorization: `Bearer ${context.cloudflareApiToken}`,
    'Content-Type': 'application/json',
  }
  const deploymentsUrl =
    `https://api.cloudflare.com/client/v4/accounts/${context.cloudflareAccountId}/pages/projects/${CF_PAGES_PROJECT}/deployments?env=production`

  // Poll up to 90 seconds
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const res = await fetch(deploymentsUrl, { headers })
      if (!res.ok) break
      const data = await res.json() as any
      const list: any[] = data?.result || []
      // Find the deployment whose commit_hash matches our SHA
      const dep = list.find((d) => {
        const hash: string | undefined = d?.deployment_trigger?.metadata?.commit_hash || d?.source?.config?.commit_hash
        return hash && hash.slice(0, 7) === shortSha
      })
      if (dep) {
        const stage = dep.latest_stage?.status || dep.status
        if (stage === 'success') {
          await markCommitDeployment(db, commitSha, 'success', null)
          return
        }
        if (stage === 'failure' || stage === 'failed') {
          // AUTO-REVERT
          try {
            const result = await revertCommit(ghToken, db, { userPrompt: context.userPrompt, model: context.model }, commitSha)
            await markCommitDeployment(db, commitSha, 'auto_reverted', JSON.stringify({ reason: 'cloudflare_build_failed', dep_id: dep.id, revert_result: result }))
          } catch (e: any) {
            await markCommitDeployment(db, commitSha, 'failed_revert_failed', JSON.stringify({ reason: 'cloudflare_build_failed', dep_id: dep.id, revert_error: e?.message }))
          }
          return
        }
      }
    } catch (_) { /* keep polling */ }
    await sleep(6_000)
  }
  await markCommitDeployment(db, commitSha, 'timeout', null)
}

async function markCommitDeployment(db: D1Database, sha: string, status: string, details: string | null) {
  try {
    // Append the status into the audit row via the message column (cheap, no new schema)
    await db.prepare(
      `UPDATE assistant_commits
       SET reverted = CASE WHEN ? = 'auto_reverted' THEN 1 ELSE reverted END,
           message = COALESCE(message,'') || ' [deploy=' || ? || ']'
       WHERE sha = ?`
    ).bind(status, status + (details ? ` ${details.slice(0, 200)}` : ''), sha).run()
  } catch (e: any) {
    console.warn('[ai-assistant] markCommitDeployment failed:', e?.message)
  }
}

function sleep(ms: number) { return new Promise<void>((res) => setTimeout(res, ms)) }

// ─── write_files: atomic multi-file commit via Git Tree API ───────────────
// Single commit per call, regardless of how many files are touched. Pre-push
// validation runs on every file before any GitHub mutation — if any file
// fails, NOTHING is committed.
async function writeFiles(
  token: string,
  db: D1Database,
  context: {
    userPrompt: string
    model: string
    cloudflareApiToken?: string
    cloudflareAccountId?: string
    waitUntil?: (p: Promise<any>) => void
  },
  input: any,
): Promise<any> {
  const files: Array<{ path: string; content: string }> = Array.isArray(input?.files) ? input.files : []
  const message: string = input?.message || ''
  if (!files.length) return { error: 'files array is required' }
  if (!message) return { error: 'message is required' }
  if (files.length > 25) return { error: `Refused: batch of ${files.length} files exceeds 25-file cap.` }

  // 1. Validate every file BEFORE making any changes
  for (const f of files) {
    if (!f?.path || f?.content === undefined) {
      return { error: `Each file needs path + content. Bad entry: ${JSON.stringify(f).slice(0, 200)}` }
    }
    const v = await validateWrite(token, f.path, f.content, context.userPrompt)
    if (!v.ok) {
      return { error: `Pre-push validation failed for "${f.path}": ${v.error}`, validation_failed: true, failed_path: f.path }
    }
  }

  // 2. Get the current head commit's sha + tree
  const headers = ghHeaders(token)
  const refRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${BRANCH}`, { headers })
  if (!refRes.ok) return { error: `Could not read branch ref: ${refRes.status} ${await refRes.text()}` }
  const refData = await refRes.json() as any
  const parentCommitSha: string = refData?.object?.sha
  if (!parentCommitSha) return { error: 'Branch ref returned no commit sha' }

  const commitRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${parentCommitSha}`, { headers })
  if (!commitRes.ok) return { error: `Could not read parent commit: ${commitRes.status}` }
  const commitData = await commitRes.json() as any
  const parentTreeSha: string = commitData?.tree?.sha

  // 3. Create a blob for each file (GitHub will dedupe identical content automatically)
  const treeEntries: any[] = []
  for (const f of files) {
    const blobRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    })
    if (!blobRes.ok) return { error: `Blob creation failed for ${f.path}: ${blobRes.status} ${await blobRes.text()}` }
    const blobData = await blobRes.json() as any
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blobData.sha })
  }

  // 4. Create a new tree based on the parent's tree
  const treeRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ base_tree: parentTreeSha, tree: treeEntries }),
  })
  if (!treeRes.ok) return { error: `Tree creation failed: ${treeRes.status} ${await treeRes.text()}` }
  const treeData = await treeRes.json() as any

  // 5. Create the commit
  const newCommitRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, tree: treeData.sha, parents: [parentCommitSha] }),
  })
  if (!newCommitRes.ok) return { error: `Commit creation failed: ${newCommitRes.status} ${await newCommitRes.text()}` }
  const newCommit = await newCommitRes.json() as any

  // 6. Update the branch ref to point at the new commit
  const updateRes = await fetch(`${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  })
  if (!updateRes.ok) return { error: `Branch ref update failed: ${updateRes.status} ${await updateRes.text()}` }

  // 7. Audit log
  try {
    await db.prepare(
      `INSERT INTO assistant_commits (sha, branch, file_paths, message, user_prompt, model)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      newCommit.sha, BRANCH, JSON.stringify(files.map(f => f.path)),
      message, context.userPrompt.slice(0, 4000), context.model,
    ).run()
  } catch (e: any) {
    console.warn('[ai-assistant] audit log insert failed:', e?.message)
  }

  // 8. Background deployment monitor
  let monitorNote = `Pushed ${newCommit.sha.slice(0, 7)} (${files.length} files). Cloudflare Pages will auto-deploy in ~30 seconds.`
  if (context.cloudflareApiToken && context.cloudflareAccountId) {
    const monitorPromise = monitorDeployment(token, db, context, newCommit.sha, files[0].path)
    if (context.waitUntil) {
      context.waitUntil(monitorPromise)
      monitorNote = `Pushed ${newCommit.sha.slice(0, 7)} (${files.length} files). Monitoring build for ~90s — will auto-revert if it fails. Query list_assistant_commits to see outcome.`
    } else {
      monitorPromise.catch((e) => console.warn('[ai-assistant] deployment monitor crashed:', e?.message))
    }
  }
  return {
    ok: true,
    commit_sha: newCommit.sha,
    short_sha: newCommit.sha.slice(0, 7),
    commit_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${newCommit.sha}`,
    files_changed: files.map(f => f.path),
    note: monitorNote,
  }
}

// ─── search_code: GitHub code-search API ──────────────────────────────────
async function searchCode(token: string, input: any): Promise<any> {
  const query: string = input?.query || ''
  const limit = Math.min(Math.max(1, Number(input?.limit) || 20), 50)
  if (!query) return { error: 'query is required' }
  // GitHub code search: scope to this repo
  const q = `${query} repo:${REPO_OWNER}/${REPO_NAME}`
  const res = await fetch(
    `${API_BASE}/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`,
    {
      headers: {
        ...ghHeaders(token),
        // Text-match media type returns surrounding line context
        Accept: 'application/vnd.github.text-match+json',
      },
    },
  )
  if (!res.ok) {
    if (res.status === 422) return { error: 'GitHub code search rejected the query. Try simpler text.', github_response: await res.text() }
    return { error: `GitHub ${res.status}: ${await res.text()}` }
  }
  const data = await res.json() as any
  return {
    total: data.total_count,
    matches: (data.items || []).map((m: any) => ({
      path: m.path,
      url: m.html_url,
      snippets: (m.text_matches || []).map((tm: any) => ({
        property: tm.property,
        fragment: tm.fragment,
      })),
    })),
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

// ── Pre-push validation ────────────────────────────────────────────────
// These run before every write_file. Each is fast and synchronous. The goal
// is to catch the obvious "this commit would break production" cases before
// they ship — corrupted JSON, unbalanced braces, truncation markers from the
// model, oversized writes, and writes to high-risk paths without explicit
// operator approval.

const MAX_FILE_BYTES = 500 * 1024  // 500KB cap — sanity limit
const HARD_BLOCK_PATHS = [
  /^\.env/,                                    // .env, .env.local etc — should never live in repo
  /^wrangler\.jsonc$/,                         // Cloudflare worker config
  /^wrangler-cron\.jsonc$/,                    // Cron worker config
]
const DANGER_PATHS = [
  /^migrations\//,                             // Schema migrations
  /^src\/routes\/auth\.ts$/,                   // Admin auth
  /^src\/routes\/customer-auth\.ts$/,          // Customer auth
  /^src\/routes\/square\.ts$/,                 // Payments — Square
  /^src\/routes\/stripe\.ts$/,                 // Payments — Stripe
  /^src\/routes\/payments\.ts$/,
  /^src\/routes\/lead-capture\.ts$/,           // Lead capture — high traffic
  /^src\/services\/gcp-auth\.ts$/,             // GCP service-account JWT minting
  /^src\/services\/gmail-oauth\.ts$/,          // Email transport credentials
  /^src\/services\/email\.ts$/,                // Email transport
  /^src\/cron-worker\.ts$/,                    // Cron worker entrypoint
  /^src\/index\.tsx$/,                         // Main app entrypoint — huge blast radius
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig\.json$/,
  /^build\.mjs$/,
]
const APPROVAL_TOKENS = [
  'confirm',
  'approved',
  'ok to push',
  'go ahead',
  'do it',
  'ship it',
  'i confirm',
  'yes change',
  'yes edit',
  'yes deploy',
]

async function validateWrite(
  token: string,
  path: string,
  content: string,
  userPrompt: string,
): Promise<{ ok: boolean; error?: string }> {
  // 1. Empty content
  if (!content || !content.trim()) {
    return { ok: false, error: 'Empty file content. Refusing — if you intended to delete the file, use delete_file.' }
  }
  // 2. Size cap
  if (content.length > MAX_FILE_BYTES) {
    return { ok: false, error: `File exceeds ${MAX_FILE_BYTES} bytes (${content.length}). If this is intentional, split the change.` }
  }
  // 3. Hard-block paths — never writable, regardless of approval
  for (const re of HARD_BLOCK_PATHS) {
    if (re.test(path)) {
      return { ok: false, error: `Path "${path}" is hard-blocked. This file should not be edited from the chat. Make the change in the Cloudflare dashboard or via wrangler.` }
    }
  }
  // 4. Danger paths — require explicit approval phrase from the operator
  for (const re of DANGER_PATHS) {
    if (re.test(path)) {
      const lower = (userPrompt || '').toLowerCase()
      const ok = APPROVAL_TOKENS.some(t => lower.includes(t))
      if (!ok) {
        return {
          ok: false,
          error: `"${path}" is a high-risk path. Refusing — ask the operator to confirm with a phrase like "confirm", "go ahead", "ok to push", or "ship it". Then retry.`,
        }
      }
    }
  }
  // 5. Truncation marker detection — common AI failure mode where the model
  //    writes "// ... rest unchanged" and the worker overwrites the whole file.
  const truncationMarkers = [
    /\/\/\s*\.\.\.\s*(rest|remaining|other)/i,
    /\/\*\s*\.\.\.\s*(rest|remaining|other)/i,
    /#\s*\.\.\.\s*(rest|remaining|other)/i,
    /<!--\s*\.\.\.\s*(rest|remaining|other)/i,
    /^\s*(\.\.\.|… )/m,                    // bare ellipsis as a line
    /^\s*\/\/\s*\(unchanged\)/im,
    /^\s*\/\/\s*\(omitted\)/im,
    /<existing[_-]code>/i,
  ]
  for (const re of truncationMarkers) {
    if (re.test(content)) {
      return {
        ok: false,
        error: 'Detected what looks like a truncation marker ("...", "rest unchanged", "<existing_code>") in the new content. Refusing — write_file overwrites the whole file, so partial content would destroy code. Re-issue write_file with the COMPLETE new file contents.',
      }
    }
  }
  // 6. File-type-specific syntax checks
  if (/\.(json|jsonc)$/.test(path)) {
    try {
      // Strip line comments + trailing commas for .jsonc; otherwise strict
      const stripped = path.endsWith('.jsonc')
        ? content.replace(/\/\/[^\n]*/g, '').replace(/,(\s*[}\]])/g, '$1')
        : content
      JSON.parse(stripped)
    } catch (e: any) {
      return { ok: false, error: `Invalid JSON: ${e?.message || e}` }
    }
  }
  if (/\.(ts|tsx|js|jsx|html|css|json)$/.test(path)) {
    const balance = checkDelimiterBalance(content, path)
    if (!balance.ok) return { ok: false, error: `Delimiter balance check failed: ${balance.error}` }
  }
  // 7. Size-shrinkage check against current file (catches accidental overwrites
  //    with truncated content even when no marker is present)
  try {
    const currentRes = await fetch(
      `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIPath(path)}?ref=${BRANCH}`,
      { headers: ghHeaders(token) },
    )
    if (currentRes.ok) {
      const current = await currentRes.json() as any
      const oldSize = current?.size || 0
      const newSize = new TextEncoder().encode(content).length
      // If we're shrinking the file by more than 60%, require approval
      if (oldSize > 2048 && newSize < oldSize * 0.4) {
        const lower = (userPrompt || '').toLowerCase()
        const approved = APPROVAL_TOKENS.some(t => lower.includes(t))
        if (!approved) {
          return {
            ok: false,
            error: `New content is ${Math.round(100 * (1 - newSize / oldSize))}% smaller than current file (${oldSize} -> ${newSize} bytes). Looks like accidental truncation. If this is intentional, ask the operator to confirm with a phrase like "confirm" or "go ahead".`,
          }
        }
      }
    }
  } catch (_) { /* if we can't fetch current, don't block */ }
  return { ok: true }
}

function checkDelimiterBalance(content: string, path: string): { ok: boolean; error?: string } {
  // Walk character-by-character ignoring content inside strings + comments
  let depth = { '(': 0, '[': 0, '{': 0 }
  let i = 0
  const n = content.length
  let line = 1
  const isJsFamily = /\.(ts|tsx|js|jsx)$/.test(path)
  while (i < n) {
    const ch = content[i]
    if (ch === '\n') { line++; i++; continue }
    // Skip strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < n && content[i] !== quote) {
        if (content[i] === '\\') { i += 2; continue }
        if (content[i] === '\n') line++
        i++
      }
      i++
      continue
    }
    // Skip line + block comments (JS family + CSS family handled together)
    if (isJsFamily && ch === '/' && content[i + 1] === '/') {
      while (i < n && content[i] !== '\n') i++
      continue
    }
    if ((isJsFamily || /\.css$/.test(path)) && ch === '/' && content[i + 1] === '*') {
      i += 2
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth[ch as '('|'['|'{']++
    else if (ch === ')') depth['(']--
    else if (ch === ']') depth['[']--
    else if (ch === '}') depth['{']--
    if (depth['('] < 0) return { ok: false, error: `Unmatched ')' near line ${line}` }
    if (depth['['] < 0) return { ok: false, error: `Unmatched ']' near line ${line}` }
    if (depth['{'] < 0) return { ok: false, error: `Unmatched '}' near line ${line}` }
    i++
  }
  if (depth['('] !== 0) return { ok: false, error: `${depth['('] > 0 ? 'Missing' : 'Extra'} ${Math.abs(depth['('])} ')'` }
  if (depth['['] !== 0) return { ok: false, error: `${depth['['] > 0 ? 'Missing' : 'Extra'} ${Math.abs(depth['['])} ']'` }
  if (depth['{'] !== 0) return { ok: false, error: `${depth['{'] > 0 ? 'Missing' : 'Extra'} ${Math.abs(depth['{'])} '}'` }
  return { ok: true }
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
