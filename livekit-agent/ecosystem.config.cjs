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
        ROOFPORTER_API_URL: 'https://www.roofreporterai.com',
        DEFAULT_GREETING: "Thank you for calling Rick's Roofing. This is Sarah. Are you calling for a new roof estimate or a repair today?"
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s'
    }
  ]
}
