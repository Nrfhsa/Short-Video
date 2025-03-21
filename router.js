const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { 
  upload, 
  uploadDir,
  cleanupOldFiles, 
  validateApiKey,
  fileHashMap,
  calculateFileHash
} = require('./lib');

function toJakartaISOString(date) {
  const jakartaTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return jakartaTime.toISOString().replace('Z', '+07:00');
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, './public/index.html'));
});

router.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    try {
      // Error handling untuk upload
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

      // Setup path dan direktori
      const uploadDir = path.join(process.cwd(), 'public/videos');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
        console.log(`Created upload directory at: ${uploadDir}`);
      }

      // Proses file
      const fileBuffer = req.file.buffer;
      const fileHash = calculateFileHash(fileBuffer);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const expiredParam = req.query.expired;
      const title = req.body.title || req.query.title || null;

      let filename, isDuplicate = false;
      const existingEntry = fileHashMap[fileHash];

      // TTL configuration
      let ttl = 86400000; // 24 jam default
      let isPermanent = false;

      if (expiredParam) {
        const hours = parseInt(expiredParam);
        if (!isNaN(hours)) {
          isPermanent = hours === 0;
          ttl = hours > 0 ? hours * 3600000 : ttl;
        }
      }

      // Handle existing entry
      if (existingEntry) {
        isDuplicate = true;
        filename = existingEntry.filename;
        
        // Update metadata
        if (title !== null) existingEntry.title = title;
        if (!existingEntry.isPermanent) {
          existingEntry.expiresAt = isPermanent ? null : Date.now() + ttl;
          existingEntry.isPermanent = isPermanent;
        }
      } else {
        // Buat entry baru
        filename = `${fileHash}${ext}`;
        fileHashMap[fileHash] = {
          filename,
          expiresAt: isPermanent ? null : Date.now() + ttl,
          isPermanent,
          likes: 0,
          comments: [],
          title
        };

        // Double-check directory sebelum write file
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Tulis file dengan error handling
        try {
          await fs.promises.writeFile(path.join(uploadDir, filename), fileBuffer);
        } catch (writeError) {
          if (writeError.code === 'ENOENT') {
            fs.mkdirSync(uploadDir, { recursive: true });
            await fs.promises.writeFile(path.join(uploadDir, filename), fileBuffer);
          } else {
            throw writeError;
          }
        }
      }

      // Build response
      const videoUrl = `${req.protocol}://${req.get('host')}/video/${filename}`;
      
      res.status(201).json({
        success: true,
        message: isDuplicate ? 'File already exists' : 'Upload successful',
        videoUrl,
        isDuplicate,
        expiresAt: fileHashMap[fileHash].expiresAt ? 
          new Date(fileHashMap[fileHash].expiresAt).toISOString() : null,
        isPermanent: fileHashMap[fileHash].isPermanent,
        fileInfo: {
          filename,
          size: req.file.size,
          mimetype: req.file.mimetype,
          title: fileHashMap[fileHash].title
        }
      });

    } catch (error) {
      console.error(`[UPLOAD ERROR] ${error.message}`);
      console.error(error.stack);
      
      res.status(500).json({
        success: false,
        message: 'Upload processing failed',
        error: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  });
});

router.get('/like', (req, res) => {
  const { video } = req.query;
  
  if (!video) return res.status(400).json({ success: false, message: 'Missing video parameter' });

  const entry = Object.values(fileHashMap).find(e => e.filename === video);
  if (!entry) return res.status(404).json({ success: false, message: 'Video not found' });

  entry.likes = (entry.likes || 0) + 1;
  res.json({ success: true, likes: entry.likes, message: 'Like added successfully' });
});

router.get('/comment', (req, res) => {
  const { text, video } = req.query;
  
  if (!text || !video) {
    return res.status(400).json({ success: false, message: 'Missing text or video parameter' });
  }

  const entry = Object.values(fileHashMap).find(e => e.filename === video);
  if (!entry) return res.status(404).json({ success: false, message: 'Video not found' });

  if (!Array.isArray(entry.comments)) entry.comments = [];
  
  const newComment = {
    text,
    timestamp: new Date().toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta',
      dateStyle: 'full',
      timeStyle: 'long'
    })
  };
  
  entry.comments.push(newComment);
  res.json({ success: true, comment: newComment, message: 'Comment added successfully' });
});

router.get('/files', validateApiKey, async (req, res) => {
  try {
    const files = [];

    for (const entry of Object.values(fileHashMap)) {
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
          title: entry.title
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          const hash = Object.keys(fileHashMap).find(h => fileHashMap[h].filename === entry.filename);
          if (hash) delete fileHashMap[hash];
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

router.get('/delete', validateApiKey, async (req, res) => {
  const { video } = req.query;
  if (!video) return res.status(400).json({ success: false, message: 'Missing video parameter' });

  try {
    if (video === 'all') {
      const files = await fs.promises.readdir(uploadDir);
      await Promise.all(files.map(file => fs.promises.unlink(path.join(uploadDir, file))));
      Object.keys(fileHashMap).forEach(key => delete fileHashMap[key]);
      return res.json({ success: true, message: 'All files deleted successfully' });
    }

    const filePath = path.join(uploadDir, video);
    const fileEntry = Object.entries(fileHashMap).find(([hash, e]) => e.filename === video);
    if (!fileEntry) return res.status(404).json({ success: false, message: 'File not found' });

    await fs.promises.unlink(filePath);
    delete fileHashMap[fileEntry[0]];
    res.json({ success: true, message: 'File deleted successfully' });

  } catch (error) {
    console.error(`Delete error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Delete operation failed' });
  }
});

function getMimeType(ext) {
  return {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime'
  }[ext.toLowerCase()] || 'application/octet-stream';
}

setInterval(() => {
  console.log('Running scheduled cleanup...');
  cleanupOldFiles();
}, 3600000);

module.exports = router;