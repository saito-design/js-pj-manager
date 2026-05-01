import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ReceiptExtracted {
  store_name: string | null;
  date: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  tax_rate: number | null;
  invoice_no: string | null;
}

// システムプロンプトは固定なのでキャッシュ対象（Sonnet 4.6 最小2048トークンを満たすよう詳細化）
const SYSTEM_PROMPT = `あなたはレシート・領収書・請求書の画像またはPDFから情報を抽出する専門のAIアシスタントです。

## 役割
日本のビジネス用途で使用されるレシート・領収書・適格請求書（インボイス）から、
経費精算に必要な情報を正確に抽出します。

## 重要な原則（必ず守る）
1. **読めない文字は推測しない**。文脈・地名・業種・典型的な店名から補完することは厳禁
2. **画像が回転していても文字の形を厳密に判定する**。傾きや向きを言い訳にしない
3. **自信が80%未満ならその項目はnull**。誤った値を入れるよりnullの方が望ましい
4. **似た漢字を混同しない**。例: 院/陰/隠、庄/圧/圭、備/俺、井/丼、東/車

## 抽出する項目と仕様

### store_name（店舗名・取引先名）
- 発行元の会社名、店舗名、個人名など
- 「〇〇株式会社」「△△店」「■■商会」などの形式
- **画像に書かれている文字を一文字ずつ厳密に読み取ること。地名や業種から推測して補完してはいけない**
- **似た漢字・地名と混同しない（例：「院庄」「備前」「井原」など岡山県の地名は明確に区別）**
- **判読困難な文字が1文字でもある場合は、自信のある部分のみ返し、不明な文字は「?」で示すか、全体をnullにする**
- 読み取れない場合はnull

### date（利用日・購入日・発行日）
- YYYY-MM-DD形式で出力（例: 2025-04-15）
- レシートの「○年○月○日」「YYYY/MM/DD」「YY.MM.DD」などを変換
- 複数の日付がある場合は取引日（購入日・利用日）を優先
- 読み取れない場合はnull

### total_amount（合計金額・税込金額）
- 数値のみ（円記号・カンマ不要）
- 「合計」「税込合計」「お支払い金額」「ご請求金額」などの最終的な支払金額
- 税抜価格のみ記載の場合は税込計算して返す
- 読み取れない場合はnull

### tax_amount（消費税額）
- 数値のみ（円記号・カンマ不要）
- 「消費税」「内税」「外税」「税額」などの税金額
- 8%と10%が混在する場合は合計税額を返す
- 記載がない場合はnull

### tax_rate（税率）
- 小数表現（10%→0.10、8%→0.08）
- 単一税率の場合はその値、混在の場合は主要税率（金額が大きい方）
- 読み取れない場合はnull

### invoice_no（インボイス番号・登録番号）
- 適格請求書発行事業者登録番号: T+13桁の数字（例: T1234567890123）
- 「登録番号」「適格請求書番号」として記載されているもの
- 一般的なレシート番号・伝票番号は対象外
- 記載がない場合はnull

## 出力形式
必ずJSONオブジェクトのみで回答してください。説明文・前置き・後書きは不要です。
値が読み取れない・記載がない場合は必ずnullを使用してください（空文字不可）。

## 例
{"store_name":"株式会社ABC商事","date":"2025-04-15","total_amount":11000,"tax_amount":1000,"tax_rate":0.10,"invoice_no":"T1234567890123"}
{"store_name":"コンビニエンスストアXYZ","date":"2025-03-28","total_amount":540,"tax_amount":49,"tax_rate":0.10,"invoice_no":null}
{"store_name":null,"date":"2025-02-10","total_amount":3300,"tax_amount":300,"tax_rate":0.10,"invoice_no":null}`;

export async function extractReceipt(buf: Buffer, mimeType: string): Promise<ReceiptExtracted> {
  const base64 = buf.toString('base64');

  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  if (!isImage && !isPdf) throw new Error(`Unsupported MIME type: ${mimeType}`);

  type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

  const mediaContent = isImage
    ? ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mimeType as ImageMediaType, data: base64 },
      })
    : ({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          mediaContent,
          { type: 'text', text: 'このレシートから情報を抽出してください。JSONのみで回答してください。' },
        ],
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  const text = textBlock.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON not found in response: ${text}`);

  const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  return {
    store_name: typeof raw.store_name === 'string' ? raw.store_name : null,
    date: typeof raw.date === 'string' ? raw.date : null,
    total_amount: typeof raw.total_amount === 'number' ? raw.total_amount : null,
    tax_amount: typeof raw.tax_amount === 'number' ? raw.tax_amount : null,
    tax_rate: typeof raw.tax_rate === 'number' ? raw.tax_rate : null,
    invoice_no: typeof raw.invoice_no === 'string' ? raw.invoice_no : null,
  };
}
