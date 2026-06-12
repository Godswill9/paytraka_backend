const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Cloudflare R2 uses S3-compatible API
// Install: npm install @aws-sdk/client-s3
let s3Client;

const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
      },
    });
  }
  return s3Client;
};

const uploadToCloudflare = async (fileBuffer, originalName, folder = 'uploads') => {
  const ext = path.extname(originalName);
  const key = `${folder}/${uuidv4()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: getMimeType(ext),
  });

  await getS3Client().send(command);

  return {
    key,
    url: `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`,
  };
};

const deleteFromCloudflare = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET,
    Key: key,
  });
  await getS3Client().send(command);
};

const getMimeType = (ext) => {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
};

module.exports = { uploadToCloudflare, deleteFromCloudflare };
