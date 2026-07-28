import { NextResponse, type NextRequest } from "next/server";

/**
 * Basic 認証による限定公開。
 *
 * 環境変数 SITE_PASSWORD が設定されているときだけ有効になる。
 * 未設定ならそのまま通すので、ローカル開発では今までどおり素で動く。
 *
 *   SITE_PASSWORD  合言葉（必須。これが無ければ保護は無効）
 *   SITE_USER      ユーザー名（省略時は "player"）
 *
 * 保護対象はページだけでなく静的アセットも含む（ブラウザは同じ保護領域へ
 * 自動的に認証情報を送るため、体感は最初の1回のダイアログだけ）。
 */

const REALM = 'Basic realm="INVADER ASSAULT", charset="UTF-8"';

/** 文字列比較にかかる時間から中身を推測されないようにする */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized() {
  return new NextResponse("認証が必要です / Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Cache-Control": "no-store",
    },
  });
}

export default function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const expectedUser = process.env.SITE_USER || "player";
  const header = request.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const separator = decoded.indexOf(":");
      if (separator !== -1) {
        const user = decoded.slice(0, separator);
        const pass = decoded.slice(separator + 1);
        if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, password)) {
          return NextResponse.next();
        }
      }
    } catch {
      // 壊れたヘッダーは未認証として扱う
    }
  }

  return unauthorized();
}

export const config = {
  // すべてのリクエストを保護する
  matcher: ["/:path*"],
};
