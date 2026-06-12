const axios = require('axios');

const getFirsConfig = (mode) => {
  const isLive = mode === 'live';
  return {
    baseURL: isLive ? process.env.FIRS_BASE_URL_LIVE : process.env.FIRS_BASE_URL_TEST,
    clientId: isLive ? process.env.FIRS_CLIENT_ID_LIVE : process.env.FIRS_CLIENT_ID_TEST,
    clientSecret: isLive ? process.env.FIRS_CLIENT_SECRET_LIVE : process.env.FIRS_CLIENT_SECRET_TEST,
  };
};

const firsRequest = (mode, token) => {
  const config = getFirsConfig(mode);
  return axios.create({
    baseURL: config.baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
};

module.exports = { getFirsConfig, firsRequest };
