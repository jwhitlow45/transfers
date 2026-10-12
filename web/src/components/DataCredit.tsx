// 511's data agreement requires this credit next to the data, and OpenStreetMap's license asks for
// its own wherever its places show (`places`).
export function DataCredit({ places = false }: { places?: boolean }) {
  return (
    <footer class="tf-credit">
      <span>
        Data provided by{' '}
        <a href="https://511.org" target="_blank" rel="noopener">
          511.org
        </a>
      </span>
      <span>
        BART data courtesy of{' '}
        <a href="https://www.bart.gov" target="_blank" rel="noopener">
          BART
        </a>
      </span>
      {places && (
        <span>
          Places ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
            OpenStreetMap
          </a>{' '}
          contributors
        </span>
      )}
    </footer>
  );
}
