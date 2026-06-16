module.exports = {
  apps: [{
    name: 's123lottery',
    script: 'server.mjs',
    cwd: '/root/s123',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_PATH: '/root/s123/lottery.db',
      KM_APPKEY: '25795669',
      KM_SECRET:  'c8a3cfaef38b4efd814eae9d2f2260b9',
      KM_SESSION: 'e7af4f59706d452fa44f85c8cdf4d767',
    }
  }]
};
