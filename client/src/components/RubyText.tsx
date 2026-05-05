import { sanitizeRuby } from "@nihongo/shared";

type Props = {
  html: string;
  className?: string;
};

export function RubyText({ html, className }: Props) {
  const safe = sanitizeRuby(html);
  return <span className={className} dangerouslySetInnerHTML={{ __html: safe }} />;
}
