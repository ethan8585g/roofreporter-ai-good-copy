module.exports = {
  apps: [
    {
      name: 'roofer-secretary-agent',
      script: 'python3',
      args: 'agent.py start',
      cwd: '/home/user/webapp/livekit-agent',
      interpreter: 'none',
      env: {
        LIVEKIT_URL: 'wss://roofreporterai-btkwkiwh.livekit.cloud',
        LIVEKIT_API_KEY: 'APIsvVZsCCaboLY',
        LIVEKIT_API_SECRET: 'UwHeCz8KszKbdgSafJjCfsEdzlYmvJZLfchTBROPJryC',
        DEFAULT_GREETING: 'Thank you for calling! My name is Sarah, how can I help you today?',
        ROOFPORTER_API_URL: 'https://roofing-measurement-tool.pages.dev'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000
    }
  ]
}
