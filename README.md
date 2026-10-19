# Chatty 💬

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Version](https://img.shields.io/badge/version-1.0.1-blue)

**🚀 Live Demo:** [https://chat-app-0jkc.onrender.com/](https://chat-app-0jkc.onrender.com/)  
*(Note: This application is hosted on Render's free tier. If the server has been inactive, the initial load may take 30–50 seconds to spin up. Thank you for your patience!)*

Chatty is a full-stack, real-time chat application designed to facilitate seamless, low-latency communication. Built with performance and user experience in mind, it leverages WebSockets to enable instant messaging, active user tracking, and secure authentication.

## ✨ Features
* **Real-Time Messaging:** Bidirectional, event-driven communication for zero-latency messaging.
* **User Authentication:** Secure login and registration using JWT (JSON Web Tokens).
* **Online Presence:** Real-time indicators showing which users are currently active.
* **Responsive UI:** Clean, mobile-friendly interface for chatting on any device.
* **Message History:** Persistent storage of previous conversations.

## 🛠️ Tech Stack
* **Frontend:** React.js / HTML5 & CSS3 (TailwindCSS)
* **Backend:** Node.js, Express.js
* **Real-Time Communication:** Socket.io
* **Database:** MongoDB (Mongoose)

## ⚙️ System Architecture & Scaling

Chatty is a full-stack real-time messaging application built on the MERN stack. It utilizes **Socket.io** for instant live messaging, **Zustand** for client-side state management, and **JWT HTTP-only cookies** for secure authentication.

### Current Setup & Future Roadmap
Currently, the backend operates on a single-server setup. To safely scale out to multiple backend servers, the architecture requires a central Pub/Sub broker to handle cross-server WebSocket broadcasting.

*I am currently integrating **[MyCache](https://github.com/Prabhav200511/MyCache)**—my custom-built, Redis-compatible in-memory database written in Go featuring built-in secure client authentication. Once integrated, MyCache will securely broadcast events across all connected Node.js instances to ensure seamless real-time message delivery.*
### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Prabhav200511/Chat-App.git](https://github.com/Prabhav200511/Chat-App.git)
   cd Chat-App
