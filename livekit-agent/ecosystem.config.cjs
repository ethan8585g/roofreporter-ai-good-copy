module.exports = {
  apps: [
    {
      name: 'roof-manager-agents',
      script: 'python3',
      args: 'src/main.py start',
      cwd: '/home/user/webapp/livekit-agent',
      interpreter: 'none',
      env: {
        LIVEKIT_URL: 'wss://roofreporterai-btkwkiwh.livekit.cloud',
        LIVEKIT_API_KEY: 'APIsvVZsCCaboLY',
        LIVEKIT_API_SECRET: 'UwHeCz8KszKbdgSafJjCfsEdzlYmvJZLfchTBROPJryC',
        ROOFPORTER_API_URL: 'https://www.roofmanager.ca',
        DEFAULT_GREETING: "Thank you for calling! This is Sarah. How can I help you today?"
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
