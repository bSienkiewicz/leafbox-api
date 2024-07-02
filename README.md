# Leafbox - API

#### Project map:
* **[Leafbox Web App](https://github.com/bSienkiewicz/leafbox)**
* **[Leafbox ESP32](https://github.com/bSienkiewicz/leafbox-esp)**
* ***Leafbox API***
---

**Leafbox API** is the backend service developed for the **Leafbox Project**, a BSc thesis initiative aimed at providing efficient data exchange and storage for plant monitoring applications. 
This API, designed to run in a Dockerized environment, connects to a MySQL database and an MQTT broker, managing data communication between frontend applications and various connected devices. It also handles the storage of plant images uploaded through the app.

## Features
- **Dockerized Deployment**: Seamless setup with Docker, ensuring a consistent environment.
- **MQTT Integration**: Listens for data from connected measuring devices via MQTT for real-time updates.
- **Database Management**: Interfaces with a MySQL database to store and retrieve plant data.
- **Image Storage**: Efficiently manages and serves plant images uploaded through the app.
- **Thesis Project**: Developed as part of a BSc thesis, showcasing practical implementation of backend technologies.

## Setup and Installation
This API requires Docker, a MySQL database, and an MQTT broker. While it's designed to work in a Dockerized environment, the Docker Compose file with required configurations cannot be shared due to university project constraints. For exploring the source code or adapting it to your needs, feel free to clone the repository.
