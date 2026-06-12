const axios = require("axios");

const getFirsConfig = (mode) => {
  const isLive = mode === "live";
  return {
    baseURL: isLive
      ? process.env.FIRS_BASE_URL_LIVE
      : process.env.FIRS_BASE_URL_TEST,
    businessKey: isLive
      ? process.env.FIRS_BUSINESS_KEY_LIVE
      : process.env.FIRS_BUSINESS_KEY_TEST,
    businessId: isLive
      ? process.env.FIRS_BUSINESS_ID_LIVE
      : process.env.FIRS_BUSINESS_ID_TEST,
  };
};

// RedTech auth is via a static X-Business-Key header — no OAuth token needed
const firsRequest = (mode) => {
  const config = getFirsConfig(mode);
  return axios.create({
    baseURL: config.baseURL,
    headers: {
      "X-Business-Key": config.businessKey,
      Accept: "*/*",
      "Content-Type": "application/json",
    },
  });
};

module.exports = { getFirsConfig, firsRequest };
