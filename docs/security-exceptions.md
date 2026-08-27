# Secret scan exceptions

The reviewed full-history baseline has no exceptions. `.gitleaksignore` must contain only an individual Gitleaks finding fingerprint; broad patterns, paths and secret values are forbidden.

Before adding an exception, rotate or revoke the credential if it can be live. Record one entry below with the fingerprint, repository path, non-secret reason, owner, expiry date and the link to the review that approved it. Remove the fingerprint and this record when the expiry is reached.

| Fingerprint | Path | Reason (without secret contents) | Owner | Expires | Review |
| --- | --- | --- | --- | --- | --- |
