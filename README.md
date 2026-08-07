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

[cite_start]Chatty is a full-stack real-time messaging application built on the MERN stack[cite: 52]. [cite_start]It utilizes **Socket.io** for instant live messaging, **Zustand** for client-side state management without full-page reloads, and **JWT** for secure, HTTP-only cookie-based authentication[cite: 53, 111]. 

### Current Setup & Future Roadmap
[cite_start]Currently, the backend operates on a single-server setup, keeping track of connected users in memory[cite: 105, 106]. [cite_start]While efficient for low traffic, running a single thread for both REST API requests and WebSocket connections can become a bottleneck as concurrent users grow[cite: 87, 88].

[cite_start]**WIP: Horizontal Scaling** To safely scale out to multiple backend servers behind a load balancer, the architecture requires a central Pub/Sub broker so servers can broadcast messages to each other[cite: 94, 101]. 

[cite_start]*We are currently in the process of integrating **[MyCache](https://github.com/Prabhav200511/MyCache)**—my custom-built, Redis-compatible in-memory database written in Go. [cite_start]Once integrated, MyCache will act as the high-speed middleman, instantly broadcasting events across all connected Node.js instances to ensure seamless real-time delivery regardless of which server a user is connected to[cite: 102, 103].*

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Prabhav200511/Chat-App.git](https://github.com/Prabhav200511/Chat-App.git)
   cd Chat-App
