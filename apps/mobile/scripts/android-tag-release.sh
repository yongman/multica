#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Android release: %s\n' "$*" >&2
  exit 1
}

tag=${GITHUB_REF#refs/tags/}
if [[ "$GITHUB_REF" != refs/tags/* ||
      ! "$tag" =~ ^v(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$ ]]; then
  fail "expected a canonical vX.Y.Z tag (major 0–2099, minor and patch 0–999)"
fi
major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
patch=${BASH_REMATCH[3]}
(( major <= 2099 )) || fail "major version exceeds 2099"
version=${tag#v}
version_code=$((1 + major * 1000000 + minor * 1000 + patch))
apk="multica-${version}-${version_code}.apk"
source_commit=$(git rev-parse --verify "${GITHUB_SHA}^{commit}")
[[ "$(git rev-parse HEAD)" == "$source_commit" ]] || fail "checkout differs from the event SHA"

android_ref=refs/remotes/origin/android
tag_ref=refs/android-apk-release/tag

validate_release_ref() {
  local fetch_options=()
  if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
    fetch_options+=(--unshallow)
  fi
  git fetch --no-tags --filter=blob:none "${fetch_options[@]}" origin \
    "+refs/heads/android:$android_ref" "+refs/tags/$tag:$tag_ref" ||
    fail "could not fetch android and $tag (the tag may have been deleted)"
  [[ "$(git rev-parse --verify "$tag_ref^{commit}")" == "$source_commit" ]] ||
    fail "$tag no longer points to the event commit"
  git merge-base --is-ancestor "$source_commit" "$android_ref" ||
    fail "$tag is not in android history"
}

valid_metadata() {
  jq -e --arg source "$source_commit" --arg version "$version" --argjson code "$version_code" '
    .sourceCommit == $source and .sourceDirty == false and
    .applicationId == "ai.multica.mobile" and .appEnv == "production" and
    .cleartextAllowed == false and .version == $version and .versionCode == $code and
    .abis == ["arm64-v8a"] and (.sha256 | test("^[0-9a-f]{64}$"))
  ' >/dev/null
}

check_payload() (
  cd "$1"
  valid_metadata <"$apk.json" || fail "APK metadata does not match the release"
  local checksum
  checksum=$(sha256sum -- "$apk")
  [[ "$checksum" == "$(cat "$apk.sha256")" &&
     "${checksum%% *}" == "$(jq -r .sha256 "$apk.json")" ]] || fail "APK SHA-256 mismatch"
)

build_apk() (
  local signing_dir output sdk_tools badging cert native_abis
  : "${MULTICA_ANDROID_KEYSTORE_BASE64:?Configure the release keystore secret}"
  : "${MULTICA_ANDROID_STORE_PASSWORD:?Configure the release store password secret}"
  : "${MULTICA_ANDROID_KEY_ALIAS:?Configure the release key alias secret}"
  cert=${MULTICA_ANDROID_CERT_SHA256,,}
  cert=${cert//:/}
  [[ "$cert" =~ ^[0-9a-f]{64}$ ]] || fail "configure MULTICA_ANDROID_CERT_SHA256 with the release certificate fingerprint"

  signing_dir=$(mktemp -d "${RUNNER_TEMP:?}/android-signing.XXXXXXXX")
  trap 'rm -rf -- "$signing_dir"' EXIT
  (
    umask 077
    printf '%s' "$MULTICA_ANDROID_KEYSTORE_BASE64" | base64 --decode >"$signing_dir/keystore"
    printf '%s\n' "$MULTICA_ANDROID_STORE_PASSWORD" >"$signing_dir/store-password"
    if [[ -n "${MULTICA_ANDROID_KEY_PASSWORD:-}" ]]; then
      printf '%s\n' "$MULTICA_ANDROID_KEY_PASSWORD" >"$signing_dir/key-password"
    fi
  )
  unset MULTICA_ANDROID_KEYSTORE_BASE64 MULTICA_ANDROID_STORE_PASSWORD MULTICA_ANDROID_KEY_PASSWORD
  export MULTICA_ANDROID_KEYSTORE="$signing_dir/keystore"
  export MULTICA_ANDROID_STORE_PASSWORD_FILE="$signing_dir/store-password"
  if [[ -f "$signing_dir/key-password" ]]; then
    export MULTICA_ANDROID_KEY_PASSWORD_FILE="$signing_dir/key-password"
  fi

  export APP_ENV=production EXPO_ANDROID_PACKAGE_PROD=ai.multica.mobile EXPO_ANDROID_ALLOW_CLEARTEXT=0
  export EXPO_PUBLIC_API_URL=https://api.multica.ai EXPO_PUBLIC_WEB_URL=https://multica.ai
  export EXPO_ANDROID_VERSION_NAME="$version" EXPO_ANDROID_VERSION_CODE="$version_code"
  export MULTICA_ANDROID_ABIS=arm64-v8a ANDROID_BUILD_TOOLS_VERSION=36.0.0
  export PATH="${JAVA_HOME:?}/bin:$PATH"
  sdk_tools="${ANDROID_HOME:?}/build-tools/$ANDROID_BUILD_TOOLS_VERSION"

  pnpm -C apps/mobile android:release
  output=apps/mobile/dist/android/production
  check_payload "$output"
  badging=$("$sdk_tools/aapt" dump badging "$output/$apk")
  [[ "$badging" == *"package: name='ai.multica.mobile' versionCode='$version_code' versionName='$version'"* ]] ||
    fail "APK Android package or version mismatch"
  native_abis=$(unzip -Z1 "$output/$apk" | awk -F / '/^lib\/[^/]+\/[^/]+\.so$/ {print $2}' | sort -u)
  [[ "$native_abis" == arm64-v8a ]] || fail "expected ARM64 as the only native ABI"
  "$sdk_tools/apksigner" verify --print-certs "$output/$apk" |
    awk -F ': ' '/^Signer #[0-9]+ certificate SHA-256 digest:/ {print tolower($2)}' >"$signing_dir/certificate"
  [[ "$(cat "$signing_dir/certificate")" == "$cert" && "$(jq -r .certificateSha256 "$output/$apk.json")" == "$cert" ]] ||
    fail "APK signer does not match MULTICA_ANDROID_CERT_SHA256"

  mkdir "$RUNNER_TEMP/android-apk"
  cp -- "$output/$apk" "$output/$apk.json" "$output/$apk.sha256" "$RUNNER_TEMP/android-apk/"
)

case "${1:-}" in
  validate) validate_release_ref ;;
  build) build_apk ;;
  *) fail "usage: android-tag-release.sh {validate|build}" ;;
esac
