# app/

The BAUD application — both faces, the Rust backend, and the two builds.

This file used to open like a front door, and it described the app as it stood at
milestone 2: three components, three Rust files, one screen. It has been wrong for a
long while, and a wrong front door is worse than no front door at all. So it is a
pointer now, and nothing else.

- **What BAUD is and why it is built this way** → [`../README.md`](../README.md).
  That is the app's source of truth. Every rule in here that was still true is in
  there, said better and kept current.
- **Where a given piece of code lives** → [`../MAP.md`](../MAP.md). One screen of
  tables: entry points, both faces, the seam, the Rust files, the build lanes.

Running it, in short — `npm install`, then `npm run tauri dev` for the desktop and
`npm run dev:phone` for the wheel. The long version, including the Linux system
packages and what "rebuild is deploy" means for the phone bundle, is in the root
README's build section.
