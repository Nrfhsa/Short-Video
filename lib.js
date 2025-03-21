const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const uploadDir = path.join(process.cwd(), 'public/videos');
const hashMapFile = path.join(__dirname, 'file-hash-map.json');
const maxFileSize = 100 * 1024 * 1024;

let fileHashMap = {};

function loadHashMapFromDisk() {
  try {
    if (fs.existsSync(hashMapFile)) {
      const data = fs.readFileSync(hashMapFile, 'utf8');
      fileHashMap = JSON.parse(data);
      console.log(`Loaded hash map with ${Object.keys(fileHashMap).length} entries`);

      for (const [hash, entry] of Object.entries(fileHashMap)) {
        const filePath = path.join(uploadDir, entry.filename);
        if (!fs.existsSync(filePath)) {
          delete fileHashMap[hash];
          console.log(`Removed missing file from hash map: ${entry.filename}`);
        } else {
          if (typeof entry.likes !== 'number') entry.likes = 0;
          if (!Array.isArray(entry.comments)) entry.comments = [];
          if (typeof entry.title !== 'string') {
          entry.title = null;
        }
      }
      saveHashMapToDisk();
    }
  } catch (error) {
    console.error('Error loading hash map:', error);
  }
}

function saveHashMapToDisk() {
  try {
    fs.writeFileSync(hashMapFile, JSON.stringify(fileHashMap, null, 2));
    console.log(`Hash map saved with ${Object.keys(fileHashMap).length} entries`);
  } catch (error) {
    console.error('Error saving hash map:', error);
  }
}

function calculateFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function cleanupOldFiles() {
  try {
    const now = Date.now();
    const filesInDir = await fs.promises.readdir(uploadDir);

    for (const [hash, entry] of Object.entries(fileHashMap)) {
      const filePath = path.join(uploadDir, entry.filename);
      if (!entry.isPermanent && entry.expiresAt < now) {
        try {
          await fs.promises.unlink(filePath);
          delete fileHashMap[hash];
          console.log(`Deleted expired file: ${entry.filename}`);
        } catch (error) {
          console.error(`Error deleting file ${entry.filename}:`, error);
        }
      }
    }

    await Promise.all(filesInDir.map(async (filename) => {
      const filePath = path.join(uploadDir, filename);
      if (!Object.values(fileHashMap).some(e => e.filename === filename)) {
        await fs.promises.unlink(filePath);
        console.log(`Deleted orphaned file: ${filename}`);
      }
    }));

    saveHashMapToDisk();
  } catch (error) {
    console.error('File cleanup error:', error);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/x-matroska'];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('INVALID_FILE_TYPE'));
  },
  limits: { fileSize: maxFileSize }
});

function initUploadDir() {
  try {
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
    console.log(`Upload directory initialized: ${uploadDir}`);
  } catch (error) {
    console.error('Upload directory initialization failed:', error);
    process.exit(1);
  }
}

const validateApiKey = (req, res, next) => {
  const providedKey = req.query.apikey || req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!validKey) {
    console.error('API_KEY is not set in environment');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  if (providedKey === validKey) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Invalid API key' });
  }
};

module.exports = { 
  initUploadDir, 
  upload, 
  uploadDir, 
  cleanupOldFiles, 
  validateApiKey,
  loadHashMapFromDisk,
  saveHashMapToDisk,
  fileHashMap,
  calculateFileHash
};