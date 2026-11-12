set shell := ["sh", "-cu"]

# Install development dependencies and configure Git hooks.
prepare:
    npm ci
    pre-commit install

# Build the package and open Wox's plugin installer.
install: package
    #!/usr/bin/env sh
    set -eu
    package="{{justfile_directory()}}/dist/wox.plugin.Dictionary.wox"
    case "$(uname -s)" in
        Darwin) open -a Wox "$package" ;;
        Linux) xdg-open "$package" ;;
        MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "$(cygpath -w "$package")" ;;
        *) echo "Unsupported platform; open $package with Wox manually." >&2; exit 1 ;;
    esac

test:
    npm test

lint:
    npm run lint

fmt:
    npm run format

package:
    npm run package

# Run every check, or only one: just check fmt
check target="all":
    #!/usr/bin/env sh
    set -eu
    case "{{target}}" in
        all) npx prettier --check .; npm run lint; npm test; npm run package ;;
        fmt) npx prettier --check . ;;
        *) echo "Unknown check target: {{target}} (expected fmt)" >&2; exit 1 ;;
    esac
