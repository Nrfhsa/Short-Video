const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const uploadDir = path.join(process.cwd(), 'public/videos');
const hashMapFile = path.join(__dirname, 'file-hash-map.json');
const maxFileSize = 100 * 1024 * 1024; // 100MB

let fileHashMap = {};

// Fungsi untuk memuat hash map dari disk
function loadHashMapFromDisk() {
  try {
    if (fs.existsSync(hashMapFile)) {
      const data = fs.readFileSync(hashMapFile, 'utf8');
      const parsedData = JSON.parse(data);

      // Pastikan parsedData adalah object
      if (typeof parsedData === 'object' && !Array.isArray(parsedData)) {
        fileHashMap = parsedData;
      } else {
        console.error('Invalid hash map format. Resetting to empty object.');
        fileHashMap = {};
      }

      console.log(`Loaded hash map with ${Object.keys(fileHashMap).length} entries`);

      // Normalisasi data lama
      for (const [hash, entry] of Object.entries(fileHashMap)) {
        if (Array.isArray(entry.title)) {
          entry.title = entry.title[0] || null; // Ambil nilai pertama jika array
        }
        if (typeof entry.title !== 'string') {
          entry.title = null;
        }
      }
    }
  } catch (error) {
    console.error('Error loading hash map:', error);
    fileHashMap = {}; // Reset ke object kosong jika error
  }
}

// Fungsi untuk menyimpan hash map ke disk
function saveHashMapToDisk() {
  try {
    const dataToSave = {};
    for (const [hash, entry] of Object.entries(fileHashMap)) {
      dataToSave[hash] = {
        filename: entry.filename,
        title: entry.title || null, // Pastikan title adalah string atau null
        expiresAt: entry.expiresAt,
        isPermanent: entry.isPermanent,
        likes: entry.likes || 0,
        comments: entry.comments || []
      };
    }
    fs.writeFileSync(hashMapFile, JSON.stringify(dataToSave, null, 2));
    console.log(`Hash map saved with ${Object.keys(dataToSave).length} entries`);
  } catch (error) {
    console.error('Error saving hash map:', error);
  }
}

// Fungsi untuk menghitung hash file
function calculateFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Fungsi untuk membersihkan file yang sudah expired
async function cleanupOldFiles() {
  try {
    const now = Date.now();
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
    saveHashMapToDisk();
  } catch (error) {
    console.error('File cleanup error:', error);
  }
}

// Konfigurasi multer untuk upload file
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/x-matroska'];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('INVALID_FILE_TYPE'));
  },
  limits: { fileSize: maxFileSize }
});

// Fungsi untuk menginisialisasi direktori upload
function initUploadDir() {
  try {
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
    console.log(`Upload directory initialized at: ${uploadDir}`);
  } catch (error) {
    console.error('Upload directory initialization failed:', error);
    process.exit(1);
  }
}

// Middleware untuk validasi API key
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