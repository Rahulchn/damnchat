# License scope and asset provenance

The root MIT license applies to this project's original code, documentation,
illustrated SVG avatars, and code-native artwork. Dependencies keep their own
licenses; installing them does not relicense them under this project's license.
The project name does not imply endorsement by a dependency or media provider.

## Avatar cleanup

The earlier files below came from third-party URLs. Their original authors,
source URLs, and reuse permissions were not recorded reliably enough to claim
redistribution rights. They have been removed from the current source tree and
from deployable assets, not relicensed:

- `gigachad.webp`, `jonah-hill.jpg`, `roll-safe.jpg`, `patrick.png`
- `handsome-squidward.png`, `sad-frog.png`, `facepalm.png`, `doge.png`

The current picker uses `orbit.svg`, `bloom.svg`, `pixel.svg`, `comet.svg`,
`sunny.svg`, `wave.svg`, `sage.svg`, and `luna.svg`, the project's existing
illustrated vector assets. Legacy avatar IDs remain accepted and map to these
illustrations, so changing the artwork does not rewrite old messages.

This cleanup does not erase the third-party files from earlier Git commits or
copies already downloaded. Older releases and history must not be assumed to
have cleared artwork rights. No history rewrite has been performed. A recoverable
local backup is ignored by Git and is outside the public static directory.

## Dependencies and provider content

Python dependencies are declared in `requirements.txt` and
`requirements-dev.txt`; JavaScript dependencies and their metadata are recorded
in `package.json` and `package-lock.json`. Preserve their license notices when
redistributing dependencies. This is a project-asset inventory, not an exhaustive
legal audit of every transitive package.

Embedded media, provider trademarks, and uploaded user content are not granted
an MIT license by this repository. Users must have the rights to share content;
the repository cannot grant rights belonging to its original owners.
