# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

---

## 0.1.0 - 2026-01-12

### Added

- On-device detection of potentially sensitive content before sending to AI chat tools
- Warning modal with clear risk explanation and confidence indicator
- Support for common sensitive patterns (API keys, passwords, tokens, private keys, etc.)
- Local-only, anonymized analytics dashboard (counts only; no content stored)
- Chrome extension UI with popup and analytics view
- Privacy-first architecture: no network requests, no remote code, no data collection
- Extension icons and Chrome Web Store–ready assets

### Removed

- Automatic redaction and text modification features (moved to experimental branch)

### Security

- All content analysis runs locally in the browser
- No prompt text, keystrokes, or page content is stored or transmitted

### Notes

- This is the initial public release focused on warnings only
- Redaction and text-modification features are under active experimentation and may return in a future release
- Users are encouraged to review the [Privacy Policy](privacy-policy.md) for full details on data handling practices
- Feedback and contributions are welcome via the [GitHub repository](https://github.com/KaikaneHAlviar/ai-privacy)
- This changelog will be updated with each new release to document changes and improvements
- Thank you for using PromptGuard to help protect your sensitive information!
