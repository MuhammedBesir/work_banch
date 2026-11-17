import { forgetLearned, learn, learnedCount } from "../write/hwr";
import { h } from "../util";
import { openDialog } from "./dialog";

type Pt = [number, number];

const SETS: [string, string][] = [
  ["Rakamlar", "0123456789"],
  ["Küçük harfler", "abcçdefgğhıijklmnoöprsştuüvyz"],
  ["Büyük harfler", "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ"],
  ["İşaretler", "+-=×/()?"],
];

/**
 * "El yazını öğret": her karakter için bir kutu; kullanıcı fareyle / kalemle yazar, Kaydet'e basınca her kutu
 * o karakterin kişisel şablonu olur (bu cihazda saklanır). Aynı karakteri birkaç kez öğretmek tanımayı güçlendirir.
 */
export function openTeach(announce: (msg: string) => void): void {
  const d = openDialog({ title: "El yazını öğret", width: 820 });
  const drawn = new Map<string, Pt[][]>();
  const counts = learnedCount();
  let set = 1;
  const grid = h("div", { class: "cm-teach__grid", role: "list" });
  const tabs = h("div", { class: "cm-seg cm-seg--sm", role: "group", "aria-label": "Karakter grubu" });
  const status = h("p", { class: "cm-muted cm-teach__status", role: "status" });

  const cell = (ch: string) => {
    const size = 84;
    const canvas = h("canvas", { class: "cm-teach__canvas", width: size * 2, height: size * 2, "aria-label": `${ch} karakterini yaz` }) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(2, 2);
      // Kılavuz: soluk harf ve taban çizgisi.
      ctx.fillStyle = "rgba(120,120,128,.16)";
      ctx.font = `600 ${size * 0.62}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ch, size / 2, size * 0.74);
      ctx.strokeStyle = "rgba(120,120,128,.25)";
      ctx.beginPath();
      ctx.moveTo(8, size * 0.74);
      ctx.lineTo(size - 8, size * 0.74);
      ctx.stroke();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0066cc";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const st of drawn.get(ch) ?? []) {
        ctx.beginPath();
        st.forEach(([x, y], i) => (i ? ctx.lineTo(x * size, y * size) : ctx.moveTo(x * size, y * size)));
        ctx.stroke();
      }
      ctx.restore();
    };
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const pt = (ev: PointerEvent): Pt => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
      const st: Pt[] = [pt(e)];
      const list = drawn.get(ch) ?? [];
      list.push(st);
      drawn.set(ch, list);
      const move = (ev: PointerEvent) => {
        for (const c of ev.getCoalescedEvents?.() ?? [ev]) st.push(pt(c));
        redraw();
      };
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        if (st.length < 2) st.push([st[0][0] + 0.01, st[0][1] + 0.01]); // nokta (i, ü)
        redraw();
        update();
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
    });
    const clear = h("button", { class: "cm-teach__clear", type: "button", title: "Sil", "aria-label": `${ch} kutusunu temizle`, onclick: () => (drawn.delete(ch), redraw(), update()) }, "×");
    const n = counts.get(ch) ?? 0;
    redraw();
    return h("div", { class: "cm-teach__cell", role: "listitem" },
      canvas,
      h("span", { class: "cm-teach__label" }, h("b", { text: ch }), n ? h("span", { class: "cm-teach__n", title: "Öğrenilmiş örnek", text: `${n}` }) : null),
      clear);
  };
  const render = () => {
    tabs.replaceChildren(...SETS.map(([label], i) => h("button", { class: i === set ? "is-on" : "", "aria-pressed": String(i === set), type: "button", onclick: () => ((set = i), render()) }, label)));
    grid.replaceChildren(...[...SETS[set][1]].map(cell));
  };
  const update = () => {
    const n = [...drawn.values()].filter((v) => v.length).length;
    status.textContent = n ? `${n} karakter yazıldı. Kaydet'e basınca öğrenilir; aynı harfi birkaç kez öğretmek daha iyi tanır.` : "Her kutuya o karakteri kendi yazınla yaz (fare, kalem ya da parmakla). Tüm kutuları doldurman gerekmez.";
  };
  render();
  update();
  d.body.append(
    h("p", { class: "cm-muted", style: "margin:0 0 12px", text: "Tanıyıcı senin yazına uysun diye karakterleri kendi elinle yaz. Özellikle sık karışan harfleri (a/d, u/ü, e/o, 1/l, 5/s) öğretmek fark yaratır. Bu örnekler yalnızca bu cihazda saklanır." }),
    tabs, grid, status,
  );
  d.foot.append(
    h("button", { class: "cm-btn cm-btn--ghost", type: "button", onclick: () => {
      forgetLearned();
      announce("Öğrenilen el yazısı silindi");
      d.close();
    } }, "Öğrenilenleri sil"),
    h("span", { style: "flex:1" }),
    h("button", { class: "cm-btn cm-btn--ghost", type: "button", onclick: () => d.close() }, "Vazgeç"),
    h("button", { class: "cm-btn cm-btn--primary", type: "button", onclick: () => {
      let n = 0;
      for (const [ch, strokes] of drawn) {
        if (!strokes.length) continue;
        learn(ch, strokes);
        n++;
      }
      d.close();
      announce(n ? `${n} karakter öğrenildi` : "Kaydedilecek yazı yok");
    } }, "Kaydet"),
  );
}
