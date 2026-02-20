# Privacy Policy — KARP Inspector Lite

**Last updated:** February 21, 2026
**Extension:** KARP Inspector Lite v1.0.0
**Developer:** SoulDriver (Adelaide, Australia)
**Contact:** matzrtrading@gmail.com

---

## Summary

KARP Inspector Lite is a fully local extension. **No data is collected, transmitted, or shared.** Everything runs on your machine.

---

## Data Collection

**We collect no data.** Specifically:

- **No telemetry** — No usage analytics, crash reports, or performance metrics are sent anywhere
- **No network requests** — The extension makes zero outbound connections after initial model download
- **No user tracking** — No cookies, device IDs, session IDs, or fingerprinting
- **No code exfiltration** — Your source code never leaves your machine

## Data Storage

The extension creates the following **local-only** files within your project directory:

- `.karp-inspector/index-cache.json` — Cached vector index for fast restart
- `.karp-inspector/snapshots/` — File snapshots for version tracking/diffing

These files are stored only on your local filesystem and are never transmitted externally.

## Embedding Model

On first use, the extension downloads a pre-trained embedding model (~50MB) from the Hugging Face model hub (`all-MiniLM-L6-v2`). This is a one-time download. After that, the model runs locally with no network access required.

The download is handled by the `@xenova/transformers` library. See [Xenova/transformers.js](https://github.com/xenova/transformers.js) for their privacy practices regarding model downloads.

## Third-Party Services

**None.** This extension:

- Requires no API keys
- Connects to no external services
- Has no backend server
- Makes no API calls

## Source Code

This extension is fully open source under the MIT License. You can audit every line of code:

- **Repository:** https://github.com/souldriver007/karp-inspector-lite

## Children's Privacy

This extension does not knowingly collect any information from anyone, including children under 13.

## Changes to This Policy

Any changes will be documented in the GitHub repository. The "Last updated" date at the top of this policy will be revised accordingly.

## Contact

For privacy questions or concerns:

- **Email:** matzrtrading@gmail.com
- **GitHub Issues:** https://github.com/souldriver007/karp-inspector-lite/issues
