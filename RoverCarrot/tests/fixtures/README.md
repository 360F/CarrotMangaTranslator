Synthetic, distributable images created with Sharp from solid colors: `page.png`,
`page.jpeg` (JPEG with JFIF header) and `page.webp` are 3×2 pixels; `pixel.png`
is 1×1. No user comics or personal data. Tests reuse the JPEG bytes under
`.jpg`, `.jpeg`, `.jfif` and uppercase extensions. Private manual data belongs
in Git-ignored `test-data/`, not here.
`config-relative.json` (relative `input`/`output`) and `config-no-paths.json` are
automated-test configs: tests run the CLI with a temporary CWD and never use
`config/local.json`.
