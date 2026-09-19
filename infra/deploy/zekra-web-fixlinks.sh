# Turbopack writes .next/node_modules/<pkg>-<hash> as symlinks with the BUILD machine's absolute
# path; on the server they must point at the bundled package: ../../node_modules/<pkg>.
fix_links() {
  d="$1/.next/node_modules"; [ -d "$d" ] || return 0
  for l in "$d"/*; do
    n=$(basename "$l"); pkg=${n%-*}
    case "$pkg" in @*) ;; esac
    rm -rf "$l"; ln -s "../../node_modules/$pkg" "$l"
    [ -e "$l" ] && echo "linked $n -> $pkg" || echo "MISSING $pkg for $n"
  done
}
