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
        DEFAULT_GREETING: "Thank you for calling! This is Sarah. How can I help you today?"
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s'
    },
    {
      name: 'outbound-caller-agent',
      script: 'python3',
      args: 'outbound_agent.py start',
      cwd: '/home/user/webapp/livekit-agent',
      interpreter: 'none',
      env: {
        LIVEKIT_URL: 'wss://roofreporterai-btkwkiwh.livekit.cloud',
        LIVEKIT_API_KEY: 'APIsvVZsCCaboLY',
        LIVEKIT_API_SECRET: 'UwHeCz8KszKbdgSafJjCfsEdzlYmvJZLfchTBROPJryC',
        ROOFPORTER_API_URL: 'https://www.roofreporterai.com',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || '',
        CARTESIA_API_KEY: process.env.CARTESIA_API_KEY || '',
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
