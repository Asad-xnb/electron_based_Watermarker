const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { spawn } = require('child_process');
const archiver = require('archiver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const processingStatus = new Map();

async function processFiles(uploadId, watermarkPath, files, options) {
  const outputDir = path.join(__dirname, '..', 'output', uploadId);
  await fs.mkdir(outputDir, { recursive: true });

  processingStatus.set(uploadId, {
    total: files.length,
    processed: 0,
    completed: false,
    errors: []
  });

  const watermarkBuffer = await fs.readFile(watermarkPath);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file.originalname).toLowerCase();
    const outputPath = path.join(outputDir, file.originalname);

    try {
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        await processImage(file.path, watermarkBuffer, outputPath, options);
      } else if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
        await processVideo(file.path, watermarkPath, outputPath, options);
      } else {
        throw new Error(`Unsupported file format: ${ext}`);
      }

      processingStatus.get(uploadId).processed++;
    } catch (error) {
      processingStatus.get(uploadId).errors.push({
        file: file.originalname,
        error: error.message
      });
      processingStatus.get(uploadId).processed++;
    }
  }

  // Create ZIP file
  const zipPath = path.join(__dirname, '..', 'output', `${uploadId}.zip`);
  await createZip(outputDir, zipPath);

  processingStatus.get(uploadId).completed = true;

  // Clean up source files
  await cleanupUpload(uploadId);
}

async function processImage(inputPath, watermarkBuffer, outputPath, options) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  // Resize watermark based on scale
  const watermarkWidth = Math.round(metadata.width * options.scale);
  const watermark = await sharp(watermarkBuffer)
    .resize(watermarkWidth)
    .toBuffer();

  const watermarkMetadata = await sharp(watermark).metadata();

  // Calculate position
  const position = calculatePosition(
    metadata.width,
    metadata.height,
    watermarkMetadata.width,
    watermarkMetadata.height,
    options.position
  );

  // Apply watermark with opacity
  const watermarkWithOpacity = await sharp(watermark)
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(255 * options.opacity)]),
      raw: {
        width: 1,
        height: 1,
        channels: 4
      },
      tile: true,
      blend: 'dest-in'
    }])
    .toBuffer();

  await image
    .composite([{
      input: watermarkWithOpacity,
      top: position.top,
      left: position.left
    }])
    .toFile(outputPath);
}

async function processVideo(inputPath, watermarkPath, outputPath, options) {
  return new Promise((resolve, reject) => {
    // Get video dimensions first using ffprobe
    const ffprobeArgs = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      inputPath
    ];

    const ffprobe = spawn(ffprobePath, ffprobeArgs);
    let probeData = '';

    ffprobe.stdout.on('data', (data) => {
      probeData += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to probe video'));
      }

      try {
        const metadata = JSON.parse(probeData);
        const stream = metadata.streams[0];
        if (!stream) return reject(new Error('No video stream found'));

        const width = stream.width;
        const height = stream.height;

        // Calculate watermark position for video
        const position = getVideoPosition(width, height, options.position, options.scale);

        // Process video with ffmpeg
        const ffmpegArgs = [
          '-i', inputPath,
          '-i', watermarkPath,
          '-filter_complex',
          `[1:v]scale=${Math.round(width * options.scale)}:-1[wm];[wm]format=rgba,colorchannelmixer=aa=${options.opacity}[wm_opacity];[0:v][wm_opacity]overlay=${position}[outv]`,
          '-map', '[outv]',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-c:a', 'copy',
          '-y',
          outputPath
        ];

        const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        });

        ffmpegProcess.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });

    ffprobe.on('error', (err) => {
      reject(err);
    });
  });
}

function calculatePosition(imgWidth, imgHeight, wmWidth, wmHeight, position) {
  const padding = 20;
  const positions = {
    'top-left': { top: padding, left: padding },
    'top-center': { top: padding, left: Math.round((imgWidth - wmWidth) / 2) },
    'top-right': { top: padding, left: imgWidth - wmWidth - padding },
    'center': { 
      top: Math.round((imgHeight - wmHeight) / 2), 
      left: Math.round((imgWidth - wmWidth) / 2) 
    },
    'bottom-left': { top: imgHeight - wmHeight - padding, left: padding },
    'bottom-center': { 
      top: imgHeight - wmHeight - padding, 
      left: Math.round((imgWidth - wmWidth) / 2) 
    },
    'bottom-right': { 
      top: imgHeight - wmHeight - padding, 
      left: imgWidth - wmWidth - padding 
    }
  };

  return positions[position] || positions['bottom-right'];
}

function getVideoPosition(width, height, position, scale) {
  const padding = 20;
  const wmWidth = Math.round(width * scale);
  const wmHeight = Math.round(height * scale);

  const positions = {
    'top-left': `${padding}:${padding}`,
    'top-center': `(W-w)/2:${padding}`,
    'top-right': `W-w-${padding}:${padding}`,
    'center': `(W-w)/2:(H-h)/2`,
    'bottom-left': `${padding}:H-h-${padding}`,
    'bottom-center': `(W-w)/2:H-h-${padding}`,
    'bottom-right': `W-w-${padding}:H-h-${padding}`
  };

  return positions[position] || positions['bottom-right'];
}

async function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function cleanupUpload(uploadId) {
  const uploadDir = path.join(__dirname, '..', 'uploads', uploadId);
  const outputDir = path.join(__dirname, '..', 'output', uploadId);

  // Add longer delay to allow all file handles to close on Windows
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Retry cleanup with exponential backoff
  const cleanup = async (dir, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        return;
      } catch (error) {
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
  };

  await cleanup(uploadDir);
  await cleanup(outputDir);
}

async function cleanup(uploadId) {
  const zipPath = path.join(__dirname, '..', 'output', `${uploadId}.zip`);
  try {
    await fs.unlink(zipPath);
    processingStatus.delete(uploadId);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

function getStatus(uploadId) {
  const status = processingStatus.get(uploadId);
  if (!status) {
    return { error: 'Upload not found' };
  }
  return status;
}

module.exports = {
  processFiles,
  getStatus,
  cleanup
};
