const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const {
  upload,
  uploadDir,
  validateApiKey,
  fileHashMap,
  calculateFileHash
} = require('./lib');

// Fungsi untuk mengonversi tanggal ke format ISO dengan timezone Jakarta
function toJakartaISOString(date) {
  const jakartaTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return jakartaTime.toISOString().replace('Z', '+07:00');
}

// Route untuk upload video
router.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    try {
      if (err) {
        const errorMap = {
          LIMIT_FILE_SIZE: { message: 'File size exceeds 100MB limit', status: 413 },
          INVALID_FILE_TYPE: { message: 'Invalid file type', status: 400 }
        };
        return res.status(errorMap[err.code]?.status || 500).json({
          success: false,
          message: errorMap[err.code]?.message || 'Upload failed'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const fileBuffer = req.file.buffer;
      const fileHash = calculateFileHash(fileBuffer);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const expiredParam = req.query.expired;
      const title = req.body.title || req.query.title || null;

      let filename, isDuplicate = false;
      const existingEntry = fileHashMap[fileHash];

      let ttl = 86400000; // Default 24 jam
      let isPermanent = false;

      if (expiredParam) {
        const hours = parseInt(expiredParam);
        if (!isNaN(hours)) {
          isPermanent = hours === 0;
          ttl = hours > 0 ? hours * 3600000 : ttl;
        }
      }

      if (existingEntry) {
        isDuplicate = true;
        filename = existingEntry.filename;

        if (title !== null && title !== undefined) {
          existingEntry.title = String(title); // Pastikan title adalah string
        }

        if (!existingEntry.isPermanent) {
          existingEntry.expiresAt = isPermanent ? null : Date.now() + ttl;
          existingEntry.isPermanent = isPermanent;
        }
      } else {
        filename = `${fileHash}${ext}`;
        fileHashMap[fileHash] = {
          filename,
          title: title || null, // Pastikan title adalah string atau null
          expiresAt: isPermanent ? null : Date.now() + ttl,
          isPermanent,
          likes: 0,
          comments: []
        };

        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        await fs.promises.writeFile(path.join(uploadDir, filename), fileBuffer);
      }

      const videoUrl = `${req.protocol}://${req.get('host')}/video/${filename}`;

      res.status(201).json({
        success: true,
        message: isDuplicate ? 'File already exists' : 'Upload successful',
        videoUrl,
        isDuplicate,
        expiresAt: fileHashMap[fileHash].expiresAt ? toJakartaISOString(new Date(fileHashMap[fileHash].expiresAt)) : null,
        isPermanent: fileHashMap[fileHash].isPermanent,
        fileInfo: {
          filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
          title: fileHashMap[fileHash].title
        }
      });
    } catch (error) {
      console.error(`Upload error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Upload processing failed'
      });
    }
  });
});

// Route untuk mendapatkan daftar file
router.get('/files', validateApiKey, async (req, res) => {
  try {
    const files = [];

    for (const [hash, entry] of Object.entries(fileHashMap)) {
      const filePath = path.join(uploadDir, entry.filename);
      try {
        const stats = await fs.promises.stat(filePath);

        files.push({
          filename: entry.filename,
          url: `${req.protocol}://${req.get('host')}/video/${entry.filename}`,
          size: stats.size,
          uploadedAt: toJakartaISOString(stats.birthtime),
          expiresAt: entry.isPermanent ? null : toJakartaISOString(new Date(entry.expiresAt)),
          isPermanent: entry.isPermanent,
          mimetype: getMimeType(path.extname(entry.filename)),
          likes: entry.likes || 0,
          comments: entry.comments || [],
          title: entry.title || null // Pastikan title adalah string atau null
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          delete fileHashMap[hash]; // Hapus entry yang tidak valid
        }
      }
    }

    res.json({
      success: true,
      count: files.length,
      files: files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    });
  } catch (error) {
    console.error(`Files error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to retrieve files' });
  }
});

// Fungsi untuk mendapatkan MIME type berdasarkan ekstensi file
function getMimeType(ext) {
  return {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime'
  }[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = router;