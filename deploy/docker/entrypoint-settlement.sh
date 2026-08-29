#!/bin/sh
#
# Shared entrypoint for the two settlement-signing services (daemon, review).
#
# Both read SETTLEMENT_SIGNER_KEYPAIR as a FILE PATH, but Fly hands us
# secrets as environment values — so the keypair travels as
# SETTLEMENT_SIGNER_KEYPAIR_B64 (base64 of the keypair JSON) and is decoded
# here, at boot, into tmpfs. C6 option (a): a devnet interim that Turnkey
# custody supersedes later. The file lives in /dev/shm, which is tmpfs in
# the container, so the plaintext key never touches the image's disk layers
# and never survives a restart.
#
# Fail-closed, like every other credentialed seam: an unset, malformed, or
# wrong-shaped secret stops the service here with a specific message rather
# than surfacing later as a confusing crash inside the chain client. The
# shape check exists for the same reason the entry-signer hex check does —
# a mis-pasted credential should fail at boot, loudly, not at first use.
#
# The decoded value is never echoed, and never appears in an error message.
set -eu

SERVICE="${SERVICE_NAME:-settlement}"
TARGET="${SETTLEMENT_KEYPAIR_TMPFS_PATH:-/dev/shm/settlement-signer.json}"

if [ -n "${SETTLEMENT_SIGNER_KEYPAIR:-}" ]; then
  # An explicit path wins — local runs and compose mount the file directly.
  echo "$SERVICE: settlement signer = MOUNTED FILE ($SETTLEMENT_SIGNER_KEYPAIR)"
elif [ -n "${SETTLEMENT_SIGNER_KEYPAIR_B64:-}" ]; then
  ( umask 077; printf '%s' "$SETTLEMENT_SIGNER_KEYPAIR_B64" | base64 -d > "$TARGET" )
  # Validate the shape before anything depends on it: a Solana keypair JSON
  # is an array of 64 byte-valued integers. Node is already in the image.
  node -e '
    const fs = require("fs");
    let k;
    try {
      k = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    } catch {
      console.error("settlement signer: SETTLEMENT_SIGNER_KEYPAIR_B64 did not decode to JSON");
      process.exit(1);
    }
    if (!Array.isArray(k) || k.length !== 64 || !k.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      console.error(
        `settlement signer: decoded keypair is not 64 bytes (got ${Array.isArray(k) ? k.length : typeof k}) — ` +
          "re-encode the keypair JSON with: base64 -w0 < keypair.json"
      );
      process.exit(1);
    }
  ' "$TARGET"
  export SETTLEMENT_SIGNER_KEYPAIR="$TARGET"
  echo "$SERVICE: settlement signer = DECODED FROM SECRET to tmpfs ($TARGET)"
else
  echo "$SERVICE: neither SETTLEMENT_SIGNER_KEYPAIR nor SETTLEMENT_SIGNER_KEYPAIR_B64 is set — refusing to start" >&2
  exit 1
fi

exec "$@"
