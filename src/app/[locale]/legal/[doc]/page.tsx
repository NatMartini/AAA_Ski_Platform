import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { LEGAL_DOCS, type LegalDocId } from "@/lib/legal";
import { toLocale } from "@/i18n/routing";

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage({
  params,
}: PageProps<"/[locale]/legal/[doc]">) {
  const { locale, doc } = await params;
  setRequestLocale(locale);

  if (!(doc in LEGAL_DOCS)) notFound();
  const loc = toLocale(locale);
  const content = LEGAL_DOCS[doc as LegalDocId][loc];

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{content.title}</h1>
      <Card className="space-y-5">
        {content.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-base font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p
                key={i}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </Card>
      <p className="text-xs text-muted-foreground">{content.updated}</p>
    </article>
  );
}
