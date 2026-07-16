export function LegalDisclosure({ className }: { readonly className: string }) {
  return (
    <div className={className} data-legal-disclosure>
      <p data-disclosure-line="attribution">
        Data: The Fjelstul World Cup Database © 2023 Joshua C. Fjelstul, Ph.D., licensed CC-BY-SA
        4.0 (
        <a href="https://github.com/jfjelstul/worldcup" target="_blank" rel="noopener noreferrer">
          github.com/jfjelstul/worldcup
        </a>
        ), modified.
      </p>
      <p data-disclosure-line="not-affiliated">
        wcdraft is an independent project and is not affiliated with, endorsed by, or associated
        with any official competition or governing body.
      </p>
    </div>
  );
}
