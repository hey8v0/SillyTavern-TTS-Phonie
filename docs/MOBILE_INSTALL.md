# Mobile installation

Phoen is a public extension. Installing it does not require a GitHub account, password, or personal access token.

## Install from SillyTavern

Open **Extensions → Install Extension** and use the exact HTTPS Git URL:

```text
https://github.com/hey8v0/SillyTavern-TTS-Phoen.git
```

Keep the branch field empty or set it to `main`.

## Android / Termux credential-helper error

The message `No credentials were returned at all as if the credential helper isn't functioning` happens before Phoen is loaded. It means the Git process used by the SillyTavern backend tried to consult a broken credential helper, often after a proxy or network response looked like an authentication challenge.

A public clone should not need credentials. In Termux, verify Git and bypass credential helpers for this clone:

```sh
pkg install git ca-certificates
cd ~/SillyTavern/public/scripts/extensions/third-party
git -c credential.helper= clone --depth 1 https://github.com/hey8v0/SillyTavern-TTS-Phoen.git
```

If `SillyTavern` is installed somewhere else, change the `cd` path to match that installation. Restart the SillyTavern server after cloning.

To diagnose the connection without installing anything:

```sh
git -c credential.helper= ls-remote https://github.com/hey8v0/SillyTavern-TTS-Phoen.git
```

If this command reports a connection reset, timeout, HTTP 401, or still asks for credentials, the failure is in the phone's Git, certificate, VPN, proxy, or GitHub connection rather than the extension.

## ZIP fallback

If Git remains unavailable:

1. Download `https://github.com/hey8v0/SillyTavern-TTS-Phoen/archive/refs/heads/main.zip`.
2. Extract the archive.
3. Rename the extracted folder from `SillyTavern-TTS-Phoen-main` to `SillyTavern-TTS-Phoen`.
4. Move it into `SillyTavern/public/scripts/extensions/third-party/`.
5. Restart the SillyTavern server and reload the page.

Do not place API keys or GitHub tokens inside the extension folder.
