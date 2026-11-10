import { Fragment } from 'preact';

// Text an agency wrote, which may hold a web address longer than a line. An address breaks after
// a "/", ".", "-", "?", "=" or "&", as a reader would break it, before any word is cut mid-letter
// (see overflow-wrap in styles.css).
export function Breakable({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/\S+|www\.\S+)/);
  if (pieces.length === 1) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, index) =>
        index % 2 === 0 ? (
          piece
        ) : (
          <Fragment key={index}>
            {piece.split(/(?<=[/.\-?=&])(?=[^/])/).map((part, n) => (
              <Fragment key={n}>
                {n > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </Fragment>
        ),
      )}
    </>
  );
}
