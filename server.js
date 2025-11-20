const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const watermarkService = require('./services/watermarkService');

const app = express();
let serverInstance = null;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', req.uploadId);
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Add upload ID to request
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/upload') {
    req.uploadId = uuidv4();
  }
  next();
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.fields([
  { name: 'watermark', maxCount: 1 },
  { name: 'files', maxCount: 100 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.watermark || !req.files.files) {
      return res.status(400).json({ error: 'Please provide both watermark and files to process' });
    }

    const watermarkPath = req.files.watermark[0].path;
    const filesToProcess = req.files.files;
    const uploadId = req.uploadId;
    
    const options = {
      position: req.body.position || 'bottom-right',
      opacity: parseFloat(req.body.opacity) || 0.7,
      scale: parseFloat(req.body.scale) || 0.2
    };

    // Process files in background
    watermarkService.processFiles(uploadId, watermarkPath, filesToProcess, options)
      .catch(err => {});

    res.json({ 
      success: true, 
      uploadId: uploadId,
      message: 'Processing started'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process files' });
  }
});

app.get('/status/:uploadId', async (req, res) => {
  try {
    const status = await watermarkService.getStatus(req.params.uploadId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.get('/download/:uploadId', async (req, res) => {
  try {
    const zipPath = path.join(__dirname, 'output', `${req.params.uploadId}.zip`);
    
    // Check if file exists
    await fs.access(zipPath);
    
    res.download(zipPath, 'watermarked-files.zip', async (err) => {
      // Clean up after download
      setTimeout(async () => {
        try {
          await watermarkService.cleanup(req.params.uploadId);
        } catch (e) {}
      }, 5000);
    });
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Start server
function start(port) {
  return new Promise((resolve) => {
    serverInstance = app.listen(port, () => {
      resolve();
    });
  });
}

// Stop server
function stop() {
  if (serverInstance) {
    serverInstance.close();
  }
}

module.exports = { start, stop };
