---
"commu": patch
---

- Redesigned dropdowns for Collections, Environments, Body Type, and Auth Type to use a premium, interactive custom UI component.
- Implemented an interactive GitHub Sync Review screen to allow users to automatically detect and exclusively mask specific environment variables before pushing, securely substituting them with local placeholders on the remote repository.
- Re-architected environments so "No Environment" is the default setting until explicitly toggled, preventing unforeseen interpolations.
- Repositioned the GitHub Sync action button to the Top Navigation Bar for enhanced accessibility.
- Refined the Request History UI into compact, card-structured elements with distinct margins and elevated hover states.
- Removed legacy libsodium GitHub Actions Secrets encryption logic and replaced it with local symmetric placeholder mappings for enhanced stability and predictability.
