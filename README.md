# PromptGuard

PromptGuard is a browser extension that helps protect your sensitive data from being accidentally shared with AI chat tools like ChatGPT, Bard, and others. It works by detecting potential sensitive information in your prompts and alerting you before you send them.

## What This Version Does

When you paste text into an AI chat tool, PromptGuard analyzes the content for sensitive information such as:

- Personal emails
- Phone numbers
- Credit card numbers
- Personal Identifiable Information (PII)
- Keys and passwords
- Other sensitive data patterns

PromptGuard will:

- Scan the text locally using rule-based detection.
- Determines a risk level (allow, warn, block).
- Alert you with a modal dialog if sensitive information is detected.

No text is modified, intercepted, stored, or transmitted.

## What It Detects

Detection combines pattern matching for common sensitive data formats (emails, phone numbers, credit cards, private keys, JWTs) with keyword-based heuristics for PII and sensitive contexts. It is not foolproof and may produce false positives or negatives.

## Analytics

PromptGuard maintains local-only aggregated analytics on the number of prompts scanned and the number of warnings shown. No prompt content or sensitive data is stored or transmitted.

## Privacy First

PromptGuard is designed with privacy as a top priority:

- All processing is done locally in your browser.
- No prompts, tokens, or user content are logged or stored.
- No data is sent to external servers.
- Analytics are local, optional, and aggregated only.
- Open source for transparency and community review.

## Roadmap

- Experimental redaction of sensitive data in prompts (opt-in).
- Site-specific adapters for common AI chat tools.
- User feedback mechanism for false positives/negatives.
- Improved detection algorithms.
- Integration with password managers for enhanced detection and security (opt-in).

## For Devs

After cloning or pulling the repo, **always run**:

- `npm install` to ensure dependencies are up to date.
- `npm run build` to build the extension files.

Then load the `dist/extension` folder as an unpacked extension in your browser at chrome://extensions.

## Contributing

Contributions are welcome! Please open issues or pull requests on GitHub.

## License

This project is licensed under the MIT License.
