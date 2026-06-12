const axios = require('axios');

const getPaystackKey = (mode) => {
  return mode === 'live'
    ? process.env.PAYSTACK_SECRET_KEY_LIVE
    : process.env.PAYSTACK_SECRET_KEY_TEST;
};

const paystackRequest = (mode) => {
  return axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
      Authorization: `Bearer ${getPaystackKey(mode)}`,
      'Content-Type': 'application/json',
    },
  });
};

module.exports = { paystackRequest, getPaystackKey };
