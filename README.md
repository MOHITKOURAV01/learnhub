<div align="center">

# LearnHub 🎓

### An open-source e-learning platform built to learn, teach, and contribute.

**Learn something. Build something. Leave something better.**

<br/>

[![Stars](https://img.shields.io/github/stars/udaycodespace/learnhub?style=for-the-badge\&logo=github\&logoColor=white)](https://github.com/udaycodespace/learnhub/stargazers)
[![Forks](https://img.shields.io/github/forks/udaycodespace/learnhub?style=for-the-badge\&logo=github\&logoColor=white)](https://github.com/udaycodespace/learnhub/network/members)
[![Contributors](https://img.shields.io/github/contributors/udaycodespace/learnhub?style=for-the-badge\&logo=github\&logoColor=white)](https://github.com/udaycodespace/learnhub/graphs/contributors)
[![License](https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge\&logo=opensourceinitiative\&logoColor=white)](LICENSE)

<br/>

[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge\&logo=mongodb\&logoColor=white)](https://www.mongodb.com)
[![Express](https://img.shields.io/badge/Express-111827?style=for-the-badge\&logo=express\&logoColor=white)](https://expressjs.com)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge\&logo=react\&logoColor=20232A)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge\&logo=node.js\&logoColor=white)](https://nodejs.org)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge\&logo=vite\&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge\&logo=docker\&logoColor=white)](https://www.docker.com)

</div>

> [!NOTE]
> **LearnHub is built in the open.** Whether you are here to learn, teach, fix, build, review, or simply explore, there is room to contribute.

## Why LearnHub? 🎯

Learning platforms look simple from the outside.

A student finds a course, clicks enroll, watches a lecture, tracks progress, and eventually receives a certificate.

But behind that experience are authentication, course management, enrollment, video delivery, progress tracking, certificates, payments, administration, and a codebase that other developers need to understand.

**LearnHub brings those pieces together in one open-source full-stack project.**

It is designed to be useful in two directions:

<div align="center">

|           For learners           |            For contributors           |
| :------------------------------: | :-----------------------------------: |
| 🎓 Discover and complete courses | 🧑‍💻 Explore a real MERN application |
|     🎥 Watch learning content    |  🔍 Understand existing architecture  |
|         📈 Track progress        |           🐛 Fix real issues          |
|       🏆 Earn certificates       |      ✨ Build meaningful features      |
|       👨‍🏫 Publish courses      |     🤝 Collaborate through GitHub     |

</div>

> [!IMPORTANT]
> **LearnHub is not trying to pretend that everything is finished.**
>
> The project is intentionally open to improvement, experimentation, and contribution.

## The Idea 💡

The core idea is straightforward:

**Make learning accessible while giving developers a real project to build on.**

```mermaid
flowchart LR

    A["🔎 Discover"] --> B["🎟️ Enroll"]
    B --> C["🎥 Learn"]
    C --> D["📈 Track"]
    D --> E["🏆 Complete"]

    style A fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    style B fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F
    style C fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
    style D fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#831843
    style E fill:#CCFBF1,stroke:#0F766E,stroke-width:2px,color:#134E4A
```

But LearnHub has another journey happening underneath the learning flow:

```mermaid
flowchart LR

    A["💡 Idea"] --> B["🧑‍💻 Build"]
    B --> C["🧪 Test"]
    C --> D["👀 Review"]
    D --> E["🚀 Improve"]
    E --> F["🌱 Next Contributor"]

    style A fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F
    style B fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    style C fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
    style D fill:#EDE9FE,stroke:#7C3AED,stroke-width:2px,color:#4C1D95
    style E fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#831843
    style F fill:#CCFBF1,stroke:#0F766E,stroke-width:2px,color:#134E4A
```

**That second journey is what makes LearnHub open source.**

## What Problem Does It Tackle? 🧩

A useful learning platform needs more than a video player.

It needs to connect the entire learning journey.

<div align="center">

| Challenge                       | LearnHub Approach                 |
| :------------------------------ | :-------------------------------- |
| 🔎 Finding relevant learning    | Searchable course catalog         |
| 🎟️ Accessing courses           | Free and mock premium enrollment  |
| 🎥 Delivering content           | Integrated video learning flow    |
| 📈 Understanding progress       | Section-level progress tracking   |
| 🏆 Proving completion           | Certificate PDF generation        |
| 👨‍🏫 Managing teaching content | Teacher dashboard                 |
| 🛡️ Managing the platform       | Admin interface                   |
| 🤝 Improving the project        | Open-source contribution workflow |

</div>

LearnHub does not claim to solve every problem in online education.

Instead, it provides a practical foundation that developers can understand, extend, improve, and learn from.

## How It Fits Together 🏗️

```mermaid
flowchart TB

    Student["🎓 Student"]
    Teacher["👨‍🏫 Teacher"]
    Admin["🛡️ Admin"]

    Frontend["⚛️ React Frontend"]
    API["🟢 Express.js API"]

    Auth["🔐 Authentication"]
    Courses["📚 Course Management"]
    Enrollment["🎟️ Enrollment"]
    Learning["🎥 Learning"]
    Progress["📈 Progress"]
    Certificates["🏆 Certificates"]
    Payments["💳 Mock Payments"]
    Users["👥 User Management"]

    Database[("🍃 MongoDB")]

    Student --> Frontend
    Teacher --> Frontend
    Admin --> Frontend

    Frontend --> API

    API --> Auth
    API --> Courses
    API --> Enrollment
    API --> Learning
    API --> Progress
    API --> Certificates
    API --> Payments
    API --> Users

    Auth --> Database
    Courses --> Database
    Enrollment --> Database
    Progress --> Database
    Payments --> Database
    Users --> Database

    style Student fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    style Teacher fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
    style Admin fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#831843
    style Frontend fill:#EDE9FE,stroke:#7C3AED,stroke-width:2px,color:#4C1D95
    style API fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F
    style Database fill:#CCFBF1,stroke:#0F766E,stroke-width:2px,color:#134E4A
```

## What You Can Do ✨

<div align="center">

|        🎓 Students       |    👨‍🏫 Teachers    |  🛡️ Administrators  |
| :----------------------: | :------------------: | :------------------: |
|     🔎 Browse courses    |   ➕ Create courses   |    👥 Manage users   |
|     🔍 Search courses    |   📝 Manage content  |   📚 Manage courses  |
|        🎟️ Enroll        |  🎥 Upload lectures  |  📊 View enrollments |
|     ▶️ Watch lectures    | 💰 Configure pricing |  🗑️ Remove courses  |
|     📈 Track progress    | 📊 Track enrollments |   🔐 Manage access   |
| 🏆 Download certificates |   🧰 Manage courses  | 🛡️ Moderate content |

</div>

## Student, Teacher & Admin Experience 🧑‍🤝‍🧑

### Student Experience

Students can:

* 🔎 Browse and search courses
* 🏷️ Explore courses by title or category
* 🎟️ Enroll in free courses
* 💳 Use the mock payment flow for premium courses
* 🎥 Watch uploaded lectures
* ✅ Mark learning sections as completed
* 📈 Track learning progress
* 🏆 Download a certificate after completion

### Teacher Experience

Teachers can:

* ➕ Create courses
* 📝 Add titles, descriptions, categories, and pricing
* 🎥 Upload `.mp4` lecture videos
* 📊 Monitor enrollment numbers
* 🧰 Manage courses they created
* 🗑️ Delete their own courses

### Admin Experience

Administrators can:

* 👥 View registered users
* 📚 Manage courses
* 🗑️ Remove courses from the platform
* 📊 View enrollment information

## Feature Status 🚦

<div align="center">

| Feature                  | Status | Current State       |
| :----------------------- | :----: | :------------------ |
| 🔎 Course discovery      |   🟢   | Available           |
| 🎟️ Enrollment           |   🟢   | Available           |
| 🎥 Video learning        |   🟢   | Local video storage |
| 📈 Progress tracking     |   🟢   | Available           |
| 🏆 Certificates          |   🟢   | PDF generation      |
| 👨‍🏫 Teacher dashboard  |   🟢   | Available           |
| 🛡️ Admin management     |   🟢   | Available           |
| 💳 Real payment gateway  |   🟡   | Planned             |
| ☁️ Cloud video hosting   |   🟡   | Planned             |
| 📋 Admin activity viewer |   🟡   | Planned             |
| 🚀 Production deployment |   🟡   | To be decided       |

</div>

> [!NOTE]
> **Status labels describe the current project state, not a promise of future delivery dates.**

## Technology Stack 🛠️

<div align="center">

|        Layer        | Technology  | Purpose                           |
| :-----------------: | :---------- | :-------------------------------- |
|     ⚛️ Frontend     | React       | Component-based application UI    |
|        🎨 UI        | Material UI | Interface components and controls |
|      🧱 Layout      | Bootstrap   | Responsive layouts and forms      |
|       ⚡ Build       | Vite        | Development and production builds |
|       🌐 HTTP       | Axios       | Frontend API communication        |
|      🟢 Runtime     | Node.js     | Backend runtime                   |
|        🔌 API       | Express.js  | Routes, middleware, controllers   |
|     🍃 Database     | MongoDB     | Persistent application data       |
|    🐳 Containers    | Docker      | Reproducible local environments   |
| 🧑‍💻 Collaboration | GitHub      | Issues, PRs, and reviews          |

</div>

## Project Structure 📁

```text
learnhub/
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middlewares/
│   ├── routers/
│   ├── schemas/
│   ├── seed.js
│   ├── .env
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── App.css
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
├── assets/
├── CONTRIBUTING.md
├── SUPPORT.md
├── LICENSE
└── README.md
```

## Getting Started 🚀

Want to explore LearnHub locally?

The setup is intentionally straightforward.

### Prerequisites

<div align="center">

| Requirement |     Version    |
| :---------: | :------------: |
|  🟢 Node.js |       18+      |
|  🍃 MongoDB | Local or cloud |
|    🔧 Git   |  Latest stable |
|  🐳 Docker  |    Optional    |

</div>

### Clone the repository

```bash
git clone https://github.com/udaycodespace/learnhub.git
cd learnhub
```

### Install dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

### Configure environment

Copy the example environment file:

```bash
cp backend/.env.example backend/.env
```

Configure the required values inside `.env`.

> [!WARNING]
> **Never commit credentials, API keys, database passwords, tokens, or other secrets to the repository.**

### Start the backend

```bash
cd backend
npm start
```

Backend:

```text
http://localhost:5000
```

### Start the frontend

Open another terminal:

```bash
cd frontend
npm run dev
```

Frontend:

```text
http://localhost:5173
```

### Seed development data

```bash
cd backend
node seed.js
```

## Local Development Accounts 🔐

<div align="center">

|      Role     | Email                   | Password             |
| :-----------: | :---------------------- | :------------------- |
|   🛡️ Admin   | `learn@learnhub.com`    | `changethispassword` |
| 👨‍🏫 Teacher | `teacher@learnhub.com`  | `teacherpassword`    |
|   🎓 Student  | `student1@learnhub.com` | `student1password`   |
|   🎓 Student  | `student2@learnhub.com` | `student2password`   |

</div>

> [!WARNING]
> These credentials are intended for **local development only**.

## Running with Docker 🐳

Start the services:

```bash
docker compose up --build
```

Stop the services:

```bash
docker compose down
```

Seed the database:

```bash
docker compose exec backend node seed.js
```

<div align="center">

|   Service   | Address                 |
| :---------: | :---------------------- |
| ⚛️ Frontend | `http://localhost:5173` |
|  🟢 Backend | `http://localhost:5000` |

</div>

## Available Scripts 🧰

### Backend

<div align="center">

| Command     | Purpose                    |
| :---------- | :------------------------- |
| `npm start` | Start backend with nodemon |

</div>

### Frontend

<div align="center">

| Command           | Purpose                          |
| :---------------- | :------------------------------- |
| `npm run dev`     | Start Vite development server    |
| `npm run build`   | Create production build          |
| `npm run preview` | Preview production build locally |

</div>

## Contribution Philosophy 🌱

LearnHub is not looking for contributions simply to increase a contributor count.

The better question is:

> **Does this make LearnHub better for the next person?**

That person might be:

* 🎓 A student using the platform
* 👨‍🏫 A teacher creating a course
* 🧑‍💻 A developer reading the code
* 🌱 A first-time contributor
* 🛡️ A future maintainer

A contribution can be:

* ✨ A feature
* 🐛 A bug fix
* 🧪 A test
* 📖 Documentation
* 🎨 UX improvement
* ♿ Accessibility work
* ⚡ Performance improvement
* 🔒 Security improvement
* 👀 A thoughtful code review

**Different contributions have different impact.**

They all matter.

## How Contributions Move 🤝

```mermaid
flowchart LR

    A["🔎 Find"] --> B["🧠 Understand"]
    B --> C["💬 Discuss"]
    C --> D["🔨 Build"]
    D --> E["🧪 Test"]
    E --> F["🚀 Pull Request"]
    F --> G["👀 Review"]
    G --> H["✨ Improve"]

    style A fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#1E3A8A
    style B fill:#EDE9FE,stroke:#7C3AED,stroke-width:2px,color:#4C1D95
    style C fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F
    style D fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
    style E fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#831843
    style F fill:#CCFBF1,stroke:#0F766E,stroke-width:2px,color:#134E4A
    style G fill:#E0E7FF,stroke:#4F46E5,stroke-width:2px,color:#312E81
    style H fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#14532D
```

The workflow is simple:

**Understand first → build carefully → test properly → open a PR → learn from review.**

## Where You Can Start 🌟

<div align="center">

|   🐛 Bug Fixes   |  🎨 Design |  🧪 Testing  |     📖 Documentation    |
| :--------------: | :--------: | :----------: | :---------------------: |
| Reproduce issues | Improve UX | Add coverage | Clarify confusing areas |

|     🔒 Security    |  ♿ Accessibility  |    ⚡ Performance   |         ✨ Features        |
| :----------------: | :---------------: | :----------------: | :-----------------------: |
| Improve safeguards | Make UX inclusive | Reduce bottlenecks | Build useful capabilities |

</div>

You do not need to start with the biggest issue.

A small, well-understood contribution is often the best way to learn the repository.

> [!TIP]
> **Start small. Understand the problem, make one focused change, and learn from the review.**

## Project Admin Support 🧑‍💼

If something does not make sense, **ask.**

You are not expected to understand the entire repository before making your first contribution.

As Project Admin, I can help contributors with:

<div align="center">

|      🧭 Navigation      |      🧠 Understanding      |  🔨 Implementation  |       👀 Review      |
| :---------------------: | :------------------------: | :-----------------: | :------------------: |
|   Find relevant files   |    Explain architecture    | Break down problems | Discuss improvements |
|   Understand structure  | Explain existing behaviour |     Debug issues    |   Refine approaches  |
| Find contribution paths |      Clarify decisions     |  Explore solutions  |  Improve PR quality  |

</div>

The goal is not simply to get a PR merged.

The goal is to help contributors understand **why** something works so they can confidently work on the next problem.

If your idea is not already represented by an issue, start a discussion before building something large.

## Roadmap 🗺️

<div align="center">

| Area                     |   Status   | Direction                   |
| :----------------------- | :--------: | :-------------------------- |
| 💳 Real payment gateway  | 🟡 Planned | Replace mock checkout       |
| ☁️ Cloud video hosting   | 🟡 Planned | Introduce Cloudinary        |
| 📋 Admin activity viewer | 🟡 Planned | Expose stored activity      |
| 🚀 Production deployment | 🟡 Planned | Decide hosting architecture |
| 🧪 Automated testing     |   🔵 Open  | Expand coverage             |
| ♿ Accessibility          |   🔵 Open  | Improve inclusive UX        |
| ⚡ Performance            |   🔵 Open  | Reduce unnecessary work     |
| ✨ Community features     |   🔵 Open  | Explore contributor ideas   |

</div>

The roadmap can evolve as the project and community evolve.

If you see a better direction, propose it.

## Open Source Programs 🌍

<a href="https://summerofcode.xyz/">

<img
src="https://raw.githubusercontent.com/udaycodespace/learnhub/main/assets/ECSoC26.webp"
width="110"
alt="ECSoC 2026"
/>

</a>

[![ECSoC 2026](https://img.shields.io/badge/ECSoC-2026-7C3AED?style=for-the-badge\&logo=opensourceinitiative\&logoColor=white)](https://summerofcode.xyz/)

## Contributors 👥

### LearnHub is better because people showed up

Every contributor below has helped move the project forward.

Some contributions change behaviour.

Some fix bugs.

Some improve the interface.

Some make the infrastructure more reliable.

Some make the project easier for the next developer to understand.

> [!NOTE]
> **Different contributions. Different strengths. One shared project.**

<div align="center">

<!-- CONTRIBUTORS-START -->

<table>
<tr>

<td align="center" width="20%">

<a href="https://github.com/MOHITKOURAV01">
<img src="https://github.com/MOHITKOURAV01.png?size=160" width="90" height="90" alt="MOHITKOURAV01"/>
<br/><br/>
<b>MOHITKOURAV01</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-2563EB?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/Jidnyasa-P">
<img src="https://github.com/Jidnyasa-P.png?size=160" width="90" height="90" alt="Jidnyasa-P"/>
<br/><br/>
<b>Jidnyasa-P</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-7C3AED?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/sujalv28">
<img src="https://github.com/sujalv28.png?size=160" width="90" height="90" alt="sujalv28"/>
<br/><br/>
<b>sujalv28</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-16A34A?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/teja-311">
<img src="https://github.com/teja-311.png?size=160" width="90" height="90" alt="teja-311"/>
<br/><br/>
<b>teja-311</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-D97706?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/Taniya-H">
<img src="https://github.com/Taniya-H.png?size=160" width="90" height="90" alt="Taniya-H"/>
<br/><br/>
<b>Taniya-H</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-DB2777?style=flat-square&logo=github&logoColor=white"/>

</td>

</tr>

<tr>

<td align="center" width="20%">

<a href="https://github.com/Aryanbuha890">
<img src="https://github.com/Aryanbuha890.png?size=160" width="90" height="90" alt="Aryanbuha890"/>
<br/><br/>
<b>Aryanbuha890</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-0891B2?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/anshika-guleria">
<img src="https://github.com/anshika-guleria.png?size=160" width="90" height="90" alt="anshika-guleria"/>
<br/><br/>
<b>anshika-guleria</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-4F46E5?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/sodium16">
<img src="https://github.com/sodium16.png?size=160" width="90" height="90" alt="sodium16"/>
<br/><br/>
<b>sodium16</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-9333EA?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/Hunter69240">
<img src="https://github.com/Hunter69240.png?size=160" width="90" height="90" alt="Hunter69240"/>
<br/><br/>
<b>Hunter69240</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-E11D48?style=flat-square&logo=github&logoColor=white"/>

</td>

<td align="center" width="20%">

<a href="https://github.com/Vachhani-Tapan">
<img src="https://github.com/Vachhani-Tapan.png?size=160" width="90" height="90" alt="Vachhani-Tapan"/>
<br/><br/>
<b>Vachhani-Tapan</b>
</a>

<br/><br/>

<img src="https://img.shields.io/badge/Contributor-0F766E?style=flat-square&logo=github&logoColor=white"/>

</td>

</tr>
</table>

<!-- CONTRIBUTORS-END -->

</div>

### Thank you for showing up

A contribution is more than a changed file.

It represents someone's **time, curiosity, effort, and willingness to work with a project they did not create.**

Whether you:

**🐛 Fixed something · ✨ Built something · 🧪 Tested something · 🎨 Improved something · 📖 Explained something · 👀 Reviewed something**

you helped move LearnHub forward.

> [!NOTE]
> **Thank you for being part of LearnHub.**

## New to Open Source? 📚

You do not need to be an expert before contributing.

Start with something understandable.

Read the code.

Ask questions.

Make a small change.

Learn from review.

Then take on something bigger.

<div align="center">

|              📚 GitHub Documentation             |                                 🔄 GitHub Flow                                 |                                      🔀 Pull Requests                                      |                                                🍴 Fork a Repository                                               |
| :----------------------------------------------: | :----------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------: |
| [GitHub Documentation](https://docs.github.com/) | [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) | [Pull Requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests) | [Fork a Repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks) |

</div>

## Need Help? 🆘

<div align="center">

|                           🐛 Found a Bug                          |                          💡 Have an Idea                          |                             💬 Want to Discuss                            |           🤝 Need Guidance           |
| :---------------------------------------------------------------: | :---------------------------------------------------------------: | :-----------------------------------------------------------------------: | :----------------------------------: |
| [Open an Issue](https://github.com/udaycodespace/learnhub/issues) | [Open an Issue](https://github.com/udaycodespace/learnhub/issues) | [Join Discussions](https://github.com/udaycodespace/learnhub/discussions) | [Read Contributing](CONTRIBUTING.md) |

</div>

## Project Maintainer 🧑‍💼

<div align="center">

<a href="https://github.com/udaycodespace">
  <img
    src="https://github.com/udaycodespace.png?size=160"
    width="100"
    height="100"
    alt="udaycodespace"
  />
</a>

<br/><br/>

### udaycodespace

[![Project Admin](https://img.shields.io/badge/Project_Admin-7C3AED?style=for-the-badge&logo=github&logoColor=white)](https://github.com/udaycodespace)

Maintaining LearnHub, supporting contributors, reviewing ideas,<br/>
and helping the project grow in the open.

</div>

## License 📄

LearnHub is distributed under the **MIT License**.

See [`LICENSE`](LICENSE) for the complete license text.

[![MIT License](https://img.shields.io/badge/MIT_License-F59E0B?style=for-the-badge\&logo=opensourceinitiative\&logoColor=white)](LICENSE)

### Learn. Build. Contribute.

**Built in the open. Improved together.**

[![Star LearnHub](https://img.shields.io/badge/⭐_Star_LearnHub-18181B?style=for-the-badge\&logo=github\&logoColor=white)](https://github.com/udaycodespace/learnhub)
