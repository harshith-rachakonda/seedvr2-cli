# 🎬 SeedVR2 CLI — AI Video Upscaler

A full-stack AI-powered video upscaling application that enhances video quality using deep learning models.
This project integrates a FastAPI backend with a modern Next.js frontend to provide a seamless video enhancement experience.

---

## 🚀 Features

* 🎥 Upload videos and upscale to higher resolution
* ⚡ FastAPI backend for AI inference
* 🎨 Modern UI built with Next.js (TypeScript)
* 🧠 Supports high-performance deep learning models (3B / 7B)
* 🔄 Real-time processing workflow
* 📂 Clean and modular architecture

---

## 🏗️ Tech Stack

### Backend

* Python
* FastAPI
* PyTorch

### Frontend

* Next.js
* TypeScript
* Tailwind CSS

---

## 📁 Project Structure

```
seedvr2-cli/
├── seedvr2_backend/   # FastAPI backend (AI processing)
├── seedvr2-ui/        # Next.js frontend (UI)
└── .gitignore
```

---

## ⚙️ Setup Instructions

### 1️⃣ Clone the Repository

```
git clone https://github.com/harshith-rachakonda/seedvr2-cli.git
cd seedvr2-cli
```

---

## 🧠 Backend Setup

```
cd seedvr2_backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend will run at:

```
http://127.0.0.1:8000
```

---

## 🎨 Frontend Setup

```
cd seedvr2-ui
npm install
npm run dev
```

Frontend will run at:

```
http://localhost:3000
```

---

## 🤖 Model & ComfyUI Setup (IMPORTANT)

This project depends on external AI models and ComfyUI.

### Install ComfyUI

```
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install -r requirements.txt
```

---

### Download Models

Download the required model weights (3B / 7B) and place them in:

```
seedvr2_backend/models/
```

> Note: Model files are not included due to size constraints.

---

## 🌐 Usage

1. Start backend server
2. Start frontend server
3. Open browser at:

```
http://localhost:3000
```

4. Upload a video and upscale 🚀

---

## 📌 Future Improvements

* 🚀 GPU optimization
* 📊 Progress tracking UI
* ☁️ Cloud deployment
* 🔁 Batch video processing

---

## 👨‍💻 Author

**Harshith Rachakonda**

* GitHub: https://github.com/harshith-rachakonda

---

## ⭐ Support

If you like this project, consider giving it a ⭐ on GitHub!
