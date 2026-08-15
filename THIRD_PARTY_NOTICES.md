# Third-party notices

## Douyin public comment sample provider

The narrow public-response field normalization in
`backend/src/douyin-public-comment-provider.ts` was informed by these source
files only:

- `JNHFlow21/social-media-toolkit@ed2f3cbdc47e6761736e915cfeb1ce1fbb364d96`,
  `social_media_toolkit/platforms/core.py` and
  `tests/test_social_extractor.py` — Apache-2.0.
- `jiji262/douyin-downloader@ad7338fdc474c14e2063370540a362cd8a953b43`,
  `core/comments_collector.py` and `tests/test_comments_collector.py` — MIT.

No Cookie, login, request-signing, proxy, browser-simulation, or access-bypass
code from either project is included or adapted here.

## Sharp

- Package: `sharp@0.35.3`
- Repository: <https://github.com/lovell/sharp>
- License: Apache-2.0
- Use: server-side, request-memory-only decoding of submitted WebP comment-card
  crops so dimensions, frame count, metadata absence, bounded pixel count, and
  opaque redaction pixels can be validated before persistence.

- Optional platform package family: `@img/sharp-libvips-*@1.3.2`
- Repository: <https://github.com/lovell/sharp-libvips>
- License: LGPL-3.0-or-later
- Use: unmodified, prebuilt platform-specific libvips shared libraries selected
  by Sharp at install/runtime. The installed macOS ARM package contains libvips
  8.18.3; the lockfile also records the other optional platform variants.

GoodJob does not modify Sharp or the prebuilt libvips packages and never gives
Sharp a client URL, filesystem path, or stream. Apache-2.0 describes the Sharp
package; the optional prebuilt libvips distribution retains its separate
LGPL-3.0-or-later terms.
