const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage(); // store in memory, upload to Cloudflare

const fileFilter = (allowedTypes) => (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed. Allowed: ${allowedTypes.join(', ')}`), false);
  }
};

const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter(['.jpg', '.jpeg', '.png', '.webp']),
});

const uploadDocument = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter(['.pdf', '.jpg', '.jpeg', '.png']),
});

const uploadImport = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter(['.xlsx', '.csv']),
});

module.exports = { uploadImage, uploadDocument, uploadImport };
