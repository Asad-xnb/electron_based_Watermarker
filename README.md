# Watermarker - Electron App

A powerful desktop application for bulk watermarking images and videos. Built with Electron, Node.js, Express, EJS, and Tailwind CSS.

## Features

- 🖼️ **Bulk Image Watermarking** - Process multiple images at once (JPG, PNG, GIF, WebP)
- 🎥 **Video Watermarking** - Apply watermarks to videos (MP4, MOV, AVI, MKV, WebM)
- ⚙️ **Customizable Options** - Control watermark position, opacity, and size
- 📦 **ZIP Export** - Download all processed files in a single ZIP archive
- 🎨 **Modern UI** - Beautiful interface with drag-and-drop support
- 📊 **Progress Tracking** - Real-time processing progress updates

## Prerequisites

Before running this application, make sure you have:

- **Node.js** (v18 or higher recommended)

**Note:** FFmpeg is now bundled with the application via `ffmpeg-static`, so you don't need to install it separately!

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

## Running the Application

Start the application with:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## How to Use

1. **Upload Watermark**: Click or drag-and-drop your watermark image (PNG with transparency recommended)
2. **Upload Files**: Select or drag-and-drop multiple images/videos to watermark
3. **Configure Options**:
   - **Position**: Choose where to place the watermark (9 positions available)
   - **Opacity**: Adjust watermark transparency (0-100%)
   - **Size**: Control watermark scale relative to the media (5-50%)
4. **Process**: Click "Apply Watermark" to start processing
5. **Download**: Once complete, download the ZIP file with all watermarked files

## Project Structure

```
Watermarker/
├── main.js                 # Electron main process
├── server.js               # Express server
├── package.json            # Dependencies and scripts
├── services/
│   └── watermarkService.js # Watermark processing logic
├── views/
│   └── index.ejs           # Main UI template
├── uploads/                # Temporary upload storage
└── output/                 # Processed files and ZIPs
```

## Technologies Used

- **Electron** - Desktop app framework
- **Node.js & Express** - Backend server
- **EJS** - Templating engine
- **Tailwind CSS** - UI styling
- **Sharp** - Image processing
- **FFmpeg** - Video processing
- **Archiver** - ZIP file creation
- **Multer** - File upload handling

## Supported Formats

**Images:** JPG, JPEG, PNG, GIF, WebP
**Videos:** MP4, MOV, AVI, MKV, WebM

## Notes

- Maximum file size: 500MB per file
- Video processing may take longer depending on file size and system performance
- Temporary files are automatically cleaned up after download

## License

MIT

## Support

For issues or questions, please open an issue on the project repository.

---

Made with ❤️ using Electron + Node.js + Tailwind CSS
