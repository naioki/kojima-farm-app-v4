"""
出荷ラベルPDF生成モジュール
A4用紙1枚に8分割（2列x4段）のラベルを生成（複数ページ対応）
最初のページに出荷一覧表を追加
"""
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm
from reportlab.lib.colors import black, gray, white, HexColor
from reportlab.platypus import Table, TableStyle
from typing import List, Dict
import os


class LabelPDFGenerator:
    """出荷ラベルPDF生成クラス"""
    
    # A4サイズ（縦）
    A4_WIDTH = 210 * mm
    A4_HEIGHT = 297 * mm
    
    # ラベルサイズ（2列x4段）
    LABEL_WIDTH = 105 * mm  # 210 / 2
    LABEL_HEIGHT = 74.25 * mm  # 297 / 4
    
    # 1ページあたりのラベル数
    LABELS_PER_PAGE = 8
    
    def __init__(self, font_path: str = None):
        """
        初期化
        
        Args:
            font_path: IPAexGothicフォントのパス（Noneの場合はデフォルトパスを試行）
        """
        self.font_path = font_path or self._find_font_path()
        self._register_font()
    
    def _find_font_path(self) -> str:
        """IPAexGothicフォントのパスを検索"""
        # 一般的なフォントパスを試行
        possible_paths = [
            'ipaexg.ttf',
            'fonts/ipaexg.ttf',
            'C:/Windows/Fonts/ipaexg.ttf',
            '/usr/share/fonts/ipaexg.ttf',
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                return path
        
        # フォントが見つからない場合は警告を出すが、後でエラーハンドリング
        return 'ipaexg.ttf'
    
    def _register_font(self):
        """IPAexGothicフォントを登録"""
        self.bold_font_available = False
        try:
            if os.path.exists(self.font_path):
                pdfmetrics.registerFont(TTFont('IPAGothic', self.font_path))
                self.font_available = True
                # 太字フォント（ipaexgb.ttf）があれば登録
                bold_paths = [
                    'ipaexgb.ttf', 'fonts/ipaexgb.ttf',
                    'C:/Windows/Fonts/ipaexgb.ttf', '/usr/share/fonts/ipaexgb.ttf',
                ]
                for bp in bold_paths:
                    if os.path.exists(bp):
                        pdfmetrics.registerFont(TTFont('IPAGothic-Bold', bp))
                        self.bold_font_available = True
                        break
            else:
                print(f"警告: フォントファイルが見つかりません: {self.font_path}")
                self.font_available = False
        except Exception as e:
            print(f"フォント登録エラー: {e}")
            self.font_available = False
    
    def _get_font_name(self) -> str:
        """使用するフォント名を返す"""
        return 'IPAGothic' if self.font_available else 'Helvetica'
    
    def _get_font_name_bold(self) -> str:
        """日付等に使う太字フォント名を返す"""
        if self.bold_font_available:
            return 'IPAGothic-Bold'
        return 'Helvetica-Bold'  # ReportLab標準の太字
    
    def _rearrange_labels_for_cut_and_stack(self, labels: List[Dict]) -> List[Dict]:
        """
        Cut and Stack形式用にラベルを再配置
        
        仕様: 各ページnにおいて、各スロットに以下のインデックスのデータを配置
        - 左上（スロット0）: n番目
        - 右上（スロット1）: n + P番目
        - 左2段目（スロット2）: n + 2P番目
        - 右2段目（スロット3）: n + 3P番目
        - ... (同様に右下まで計8スロット)
        
        変換式:
        - 元のインデックスiに対して:
          - slot = i // P (スロット番号: 0-7)
          - page = i % P (ページ番号: 0から開始)
        - 再配置後のインデックスj = page * 8 + slot
        
        Args:
            labels: 元のラベルリスト
            
        Returns:
            再配置されたラベルリスト（空のスロットは空の辞書で埋める）
        """
        total_labels = len(labels)
        total_pages = (total_labels + self.LABELS_PER_PAGE - 1) // self.LABELS_PER_PAGE
        
        if total_pages == 0:
            return []
        
        total_slots = total_pages * self.LABELS_PER_PAGE
        
        # 再配置後のリストを初期化（空の辞書で埋める）
        rearranged = [{}] * total_slots
        
        # 元のインデックスiを、再配置後のインデックスjに変換
        for i in range(total_labels):
            slot = i // total_pages  # スロット番号 (0-7)
            page = i % total_pages   # ページ番号 (0から開始)
            # 再配置後のインデックス: ページpageのスロットslotの位置
            j = page * self.LABELS_PER_PAGE + slot
            if j < total_slots:
                rearranged[j] = labels[i]
        
        return rearranged
    
    def generate_pdf(self, labels: List[Dict], summary_data: List[Dict], 
                    shipment_date: str, output_path: str):
        """
        PDFを生成（複数ページ対応 + 出荷一覧表）
        Cut and Stack形式: 裁断後に重ねるだけで順番が揃う
        
        Args:
            labels: ラベル情報のリスト（全ラベル）
            summary_data: 出荷一覧表用のデータ
            shipment_date: 出荷日（YYYY-MM-DD形式）
            output_path: 出力PDFファイルパス
        """
        c = canvas.Canvas(output_path, pagesize=(self.A4_WIDTH, self.A4_HEIGHT))
        font_name = self._get_font_name()
        
        # 出荷日を表示用に変換（月/日、ゼロ埋めなし 例: 2/7）
        from datetime import datetime
        shipment_date_obj = datetime.strptime(shipment_date, '%Y-%m-%d')
        shipment_date_display = f"{shipment_date_obj.month}月{shipment_date_obj.day}日"  # 口数と区別するため漢字表記
        
        # 1ページ目：出荷一覧表
        self._draw_summary_page(c, summary_data, shipment_date, font_name)
        
        # 出荷一覧表の後に改ページ（ラベルページと分離）
        c.showPage()
        
        # Cut and Stack形式に再配置
        rearranged_labels = self._rearrange_labels_for_cut_and_stack(labels)
        total_labels = len(labels)
        total_pages = (total_labels + self.LABELS_PER_PAGE - 1) // self.LABELS_PER_PAGE
        
        # スロット順序: 左上(0) → 右上(1) → 左2段目(2) → 右2段目(3) → ... → 右4段目(7)
        slot_to_pos = [
            (0, 0),  # スロット0: 左上
            (1, 0),  # スロット1: 右上
            (0, 1),  # スロット2: 左2段目
            (1, 1),  # スロット3: 右2段目
            (0, 2),  # スロット4: 左3段目
            (1, 2),  # スロット5: 右3段目
            (0, 3),  # スロット6: 左4段目
            (1, 3),  # スロット7: 右4段目
        ]
        
        # 各ページを描画
        for page_idx in range(total_pages):
            if page_idx > 0:  # 2ページ目以降は改ページ
                c.showPage()
            
            # このページの各スロットを描画
            for slot in range(self.LABELS_PER_PAGE):
                # 再配置後のインデックス: ページpage_idxのスロットslotの位置
                rearranged_idx = page_idx * self.LABELS_PER_PAGE + slot
                
                # 空のスロットはスキップ（エラーを防ぐ）
                if rearranged_idx >= len(rearranged_labels):
                    continue
                
                label = rearranged_labels[rearranged_idx]
                
                # 空の辞書の場合はスキップ
                if not label or not label.get('store'):
                    continue
                
                # スロット位置から列・行を取得
                col, row = slot_to_pos[slot]
                
                # 座標計算
                x = col * self.LABEL_WIDTH
                y = self.A4_HEIGHT - (row + 1) * self.LABEL_HEIGHT
                
                # 端数ラベルの判定は is_fraction フラグのみで行う。
                # （最後の箱 X/X でも、実際に端数でなければ強調しない＝積むとき端数だけ目立たせる目的）
                is_fraction = label.get('is_fraction', False)

                # ラベルを描画
                if is_fraction:
                    self._draw_fraction_label(c, x, y, label, font_name)
                else:
                    self._draw_standard_label(c, x, y, label, font_name)
                
                # 切断用ガイド線（再配置後のインデックスを使用）
                # 最後のラベルかどうかは、再配置後のインデックスとtotal_labelsで判定
                is_last_label = (rearranged_idx >= total_labels - 1)
                self._draw_guide_lines(c, x, y, col, row, rearranged_idx, total_labels, is_last_label)
        
        c.save()
    
    def _draw_summary_page(self, c: canvas.Canvas, summary_data: List[Dict],
                          raw_shipment_date: str, font_name: str):
        """出荷一覧表ページを描画（TableオブジェクトとTableStyleを使用）"""
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import Paragraph
        from collections import OrderedDict

        # 出荷日の解析とフォーマット
        from datetime import datetime
        try:
            dt = datetime.strptime(raw_shipment_date, '%Y-%m-%d')
            full_date_str = f"{dt.year}年{dt.month}月{dt.day}日"
            display_date_str = f"{dt.month}月{dt.day}日"
        except Exception:
            full_date_str = raw_shipment_date
            display_date_str = raw_shipment_date

        # フォントサイズを調整（A4一枚に確実に収まるように最適化）
        title_font_size = 26
        header_font_size = 16
        data_font_size = 14

        # タイトル（上マージン最小限に）
        c.setFont(font_name, title_font_size)
        c.drawString(10 * mm, self.A4_HEIGHT - 22 * mm, f"【出荷一覧表】 {display_date_str}")

        # 店舗別コンテナ合計を事前計算（順序保持）
        store_containers: "OrderedDict[str, int]" = OrderedDict()
        for entry in summary_data:
            s = str(entry.get('store', ''))
            boxes = int(entry.get('boxes', 0))
            rem_box = 1 if int(entry.get('remainder', 0)) > 0 else 0
            store_containers[s] = store_containers.get(s, 0) + boxes + rem_box

        # 5列テーブル（コンテナ列はSPANを避けてcanvasで手描き）
        styles = getSampleStyleSheet()
        store_style = ParagraphStyle(
            'StoreStyle',
            parent=styles['Normal'],
            fontName=font_name,
            fontSize=data_font_size,
            leading=data_font_size + 2,
            textColor=black
        )
        item_style = ParagraphStyle(
            'ItemStyle',
            parent=styles['Normal'],
            fontName=font_name,
            fontSize=data_font_size,
            leading=data_font_size + 2,
            textColor=black
        )

        header_row = ["店舗名", "品目", "フル箱", "端数箱", "合計"]
        table_data = [header_row]
        store_first_row: dict = {}  # store -> 先頭行インデックス
        store_last_row: dict  = {}  # store -> 末尾行インデックス

        prev_store: str | None = None
        for entry in summary_data:
            store = str(entry.get('store', ''))
            item_display = str(entry.get('item_display', entry.get('item', '')))
            boxes = int(entry.get('boxes', 0))
            unit_label = entry.get('unit_label', '')
            raw_remainder = int(entry.get('remainder', 0))
            rem_display = f"{raw_remainder}{unit_label}" if raw_remainder > 0 else "—"
            total_quantity = entry.get('total_quantity', 0)
            total_display = f"{total_quantity}{unit_label}" if total_quantity > 0 and unit_label else str(total_quantity)

            row_idx = len(table_data)
            if store not in store_first_row:
                store_first_row[store] = row_idx
            store_last_row[store] = row_idx

            store_display = store if store != prev_store else ""
            table_data.append([
                Paragraph(store_display, store_style) if store_display else "",
                Paragraph(item_display, item_style) if item_display else "",
                str(boxes),
                rem_display,
                total_display
            ])
            prev_store = store

        # 合計行を追加（全店舗コンテナ総数）
        total_containers = sum(store_containers.values())
        total_row_idx = len(table_data)
        table_data.append(["合計", "", "", "", ""])

        # 列幅（5列: 合計168mm、残り22mmをコンテナ列として手描き）
        col_widths = [38 * mm, 48 * mm, 26 * mm, 26 * mm, 30 * mm]  # 合計 168mm
        container_col_w = 22 * mm

        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table_style = TableStyle([
            ('GRID',          (0, 0), (-1, -1), 1.0, HexColor('#666666')),
            ('BACKGROUND',    (0, 0), (-1,  0), HexColor('#C0C0C0')),
            ('TEXTCOLOR',     (0, 0), (-1,  0), black),
            ('ALIGN',         (0, 0), (-1,  0), 'CENTER'),
            ('FONTNAME',      (0, 0), (-1,  0), font_name),
            ('FONTSIZE',      (0, 0), (-1,  0), header_font_size),
            ('BOTTOMPADDING', (0, 0), (-1,  0), 8),
            ('TOPPADDING',    (0, 0), (-1,  0), 8),
            ('FONTNAME',      (0, 1), (-1, -1), font_name),
            ('FONTSIZE',      (0, 1), (-1, -1), data_font_size),
            ('ALIGN',         (0, 1), (-1, -1), 'LEFT'),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('ROWBACKGROUNDS',(0, 1), (-1, -2), [white, HexColor('#F0F0F0')]),
            ('LEFTPADDING',   (0, 0), (-1, -1), 4),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 4),
            ('TOPPADDING',    (0, 1), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
            # 合計行スタイル
            ('BACKGROUND',    (0, total_row_idx), (-1, total_row_idx), HexColor('#DCDCDC')),
            ('FONTSIZE',      (0, total_row_idx), (-1, total_row_idx), data_font_size),
            ('ALIGN',         (0, total_row_idx), (-1, total_row_idx), 'CENTER'),
            ('TOPPADDING',    (0, total_row_idx), (-1, total_row_idx), 7),
            ('BOTTOMPADDING', (0, total_row_idx), (-1, total_row_idx), 7),
        ])
        table.setStyle(table_style)

        table_x = 10 * mm
        table_y = self.A4_HEIGHT - 48 * mm
        table_width, table_height = table.wrap(0, 0)
        table.drawOn(c, table_x, table_y - table_height)

        # ── コンテナ列を canvas で手描き ────────────────────────────────
        row_heights = table._rowHeights  # wrap() 後に確定
        cont_x = table_x + sum(col_widths)        # コンテナ列左端
        cont_cx = cont_x + container_col_w / 2   # コンテナ列中央X

        # ヘッダーセル
        hdr_h = row_heights[0]
        hdr_y = table_y - hdr_h
        c.setFillColor(HexColor('#C0C0C0'))
        c.setStrokeColor(HexColor('#666666'))
        c.setLineWidth(1.0)
        c.rect(cont_x, hdr_y, container_col_w, hdr_h, stroke=1, fill=1)
        c.setFillColor(black)
        c.setFont(font_name, header_font_size)
        c.drawCentredString(cont_cx, hdr_y + (hdr_h - header_font_size * 0.7) / 2, "コンテナ")

        # 各店舗のコンテナ数セルを手描き（店舗グループをまとめた1セル）
        c.setStrokeColor(HexColor('#666666'))
        c.setLineWidth(1.0)
        for store, first_row in store_first_row.items():
            last_row = store_last_row[store]
            # グループの上端Y・下端Y を計算
            top_y    = table_y - sum(row_heights[:first_row])
            bottom_y = table_y - sum(row_heights[:last_row + 1])
            cell_h   = top_y - bottom_y
            # セル枠（背景は白）
            c.setFillColor(white)
            c.rect(cont_x, bottom_y, container_col_w, cell_h, stroke=1, fill=1)
            # コンテナ数テキスト（黒・大・中央）
            text = str(store_containers[store])
            font_sz = data_font_size + 8
            text_y  = bottom_y + (cell_h - font_sz * 0.7) / 2
            c.setFillColor(black)
            c.setFont(font_name, font_sz)
            c.drawCentredString(cont_cx, text_y, text)

        # ── 合計コンテナセル（最終行）────────────────────────────────────
        total_top_y    = table_y - sum(row_heights[:total_row_idx])
        total_bottom_y = table_y - sum(row_heights[:total_row_idx + 1])
        total_cell_h   = total_top_y - total_bottom_y
        # 濃いグレー背景・白テキスト
        c.setFillColor(HexColor('#3A3A3A'))
        c.setStrokeColor(HexColor('#666666'))
        c.setLineWidth(1.0)
        c.rect(cont_x, total_bottom_y, container_col_w, total_cell_h, stroke=1, fill=1)
        c.setFillColor(white)
        total_font_sz = data_font_size + 8
        total_text_y  = total_bottom_y + (total_cell_h - total_font_sz * 0.7) / 2
        c.setFont(font_name, total_font_sz)
        c.drawCentredString(cont_cx, total_text_y, str(total_containers))
        
        # ── 納品書セクションの計算と描画 ────────────────────────────────
        # 品目×規格ごとに集計（入力順を保持しつつ重複を合算）
        item_totals: dict = {}  # (item, spec) → total_quantity
        item_units: dict = {}
        for entry in summary_data:
            key = (entry.get('item', ''), entry.get('spec', '').strip())
            item_totals[key] = item_totals.get(key, 0) + entry.get('total_quantity', 0)
            item_units[key] = entry.get('unit_label', '')

        # 納品書テーブルを先に構築して高さを測定
        # 品目名→規格でソートし、同じ品目（例: 胡瓜）が必ず隣り合うようにまとめる
        nb_header = ["品目", "規格", "数量", "単位", "単価", "金額", "備考"]
        nb_data = [nb_header]
        for (item, spec), qty in sorted(item_totals.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            unit_label = item_units.get((item, spec), '')
            nb_data.append([item, spec or "—", str(qty), unit_label, "", "", ""])

        nb_col_widths = [36*mm, 28*mm, 24*mm, 18*mm, 28*mm, 28*mm, 28*mm]  # 190mm
        nb_table = Table(nb_data, colWidths=nb_col_widths)
        nb_table.setStyle(TableStyle([
            ('FONTNAME',    (0,0), (-1,-1), font_name),
            ('FONTSIZE',    (0,0), (-1, 0), 12),
            ('FONTSIZE',    (0,1), (-1,-1), 10),
            ('TOPPADDING',  (0,0), (-1,-1), 3),
            ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ]))
        _, nb_h = nb_table.wrap(0, 0)

        # 納品書が必要とする総高さの計算
        gap_before = 16 * mm  # キリトリ用の空白マージン（十分なスペースを確保）
        nb_header_h = 10 * mm
        nb_header_gap = 8 * mm
        bottom_margin = 15 * mm
        required_height = gap_before + nb_header_h + nb_header_gap + nb_h + bottom_margin

        table_bottom_y = table_y - table_height
        fits_on_one_page = (table_bottom_y >= required_height)

        if fits_on_one_page:
            # ── 1枚に収まる場合：キリトリ線を描画して配置 ──
            cut_y = table_bottom_y - (gap_before / 2)
            c.setStrokeColor(gray, alpha=0.5)
            c.setLineWidth(0.8)
            c.setDash([6, 4])
            c.line(10 * mm, cut_y, self.A4_WIDTH - 10 * mm, cut_y)
            c.setDash()  # リセット
            
            c.setFont(font_name, 8)
            c.setFillColor(gray)
            c.drawCentredString(self.A4_WIDTH / 2, cut_y + 1.5 * mm, "8< - - - - - - - - - - キ リ ト リ - - - - - - - - - - 8<")
            c.setFillColor(black)

            delivery_start_y = table_bottom_y - gap_before
            self._draw_delivery_slip_section(c, full_date_str, font_name, delivery_start_y, nb_table, nb_h)
        else:
            # ── 1枚に収まらない場合：2ページ目に丸ごと改ページして配置（キリトリ線なし） ──
            c.showPage()
            delivery_start_y = self.A4_HEIGHT - 22 * mm
            self._draw_delivery_slip_section(c, full_date_str, font_name, delivery_start_y, nb_table, nb_h)

    def _draw_delivery_slip_section(self, c: canvas.Canvas, full_date_str: str,
                                    font_name: str, start_y: float,
                                    nb_table: Table, nb_h: float):
        """納品書セクションを描画するヘルパー"""
        summary_title_font_size = 14
        header_font_size = 12
        summary_data_font_size = 10
        
        # セクションタイトル
        c.setFont(font_name, summary_title_font_size)
        c.drawString(10 * mm, start_y, "【納品書】")
        
        # 日付 (右寄せ)
        c.setFont(font_name, 10)
        c.drawRightString(self.A4_WIDTH - 10 * mm, start_y + 4 * mm, f"日付: {full_date_str}")
        
        # 納品書テーブルを描画
        nb_style = TableStyle([
            ('GRID',        (0,0), (-1,-1), 0.8, HexColor('#888888')),
            ('BACKGROUND',  (0,0), (-1, 0), HexColor('#D0D0D0')),
            ('FONTNAME',    (0,0), (-1,-1), font_name),
            ('FONTSIZE',    (0,0), (-1, 0), header_font_size),
            ('FONTSIZE',    (0,1), (-1,-1), summary_data_font_size),
            ('ALIGN',       (0,0), (-1, 0), 'CENTER'),
            ('ALIGN',       (2,1), (3,-1), 'RIGHT'),
            ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING',  (0,0), (-1,-1), 3),
            ('BOTTOMPADDING',(0,0),(-1,-1), 3),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[white, HexColor('#F5F5F5')]),
        ])
        nb_table.setStyle(nb_style)
        nb_y = start_y - 8 * mm
        nb_table.drawOn(c, 10 * mm, nb_y - nb_h)
    
    def _draw_text_in_quadrant(self, c: canvas.Canvas, text: str, font_name: str, 
                               max_font_size: int, quadrant_width: float, 
                               quadrant_height: float) -> tuple:
        """
        指定された領域内に収まるようにフォントサイズを自動調整してテキストを描画
        
        Returns:
            (font_size, text_width, text_height) のタプル
        """
        font_size = max_font_size
        text_width = c.stringWidth(text, font_name, font_size)
        text_height = font_size * 0.7  # フォント高さの概算
        
        # 領域内に収まるまでフォントサイズを縮小
        while (text_width > quadrant_width * 0.9 or 
               text_height > quadrant_height * 0.9) and font_size > 8:
            font_size -= 1
            text_width = c.stringWidth(text, font_name, font_size)
            text_height = font_size * 0.7
        
        return font_size, text_width, text_height
    
    def _draw_standard_label(self, c: canvas.Canvas, x: float, y: float, 
                            label: Dict, font_name: str):
        """通常ラベルを描画（4つの領域に厳格に分割）"""
        # ラベル枠（薄い線）
        c.setStrokeColor(gray, alpha=0.3)
        c.setLineWidth(0.5)
        c.rect(x, y, self.LABEL_WIDTH, self.LABEL_HEIGHT, stroke=1, fill=0)
        
        # テキスト色を黒に
        c.setFillColor(black)
        
        # 4つの領域のサイズ
        q_width = self.LABEL_WIDTH / 2  # 52.5mm
        q_height = self.LABEL_HEIGHT / 2  # 37.125mm
        
        # Q1: 左上 - 目的地（店舗名）を最大サイズ（中央寄せ）
        store = label.get('store', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, store, font_name, 50, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q1_center_x = x + q_width / 2  # Q1の中央X座標
        q1_center_y = y + self.LABEL_HEIGHT - q_height / 2  # Q1の中央Y座標
        c.drawString(q1_center_x - text_width / 2, q1_center_y - text_height / 2, store)
        
        # Q2: 右上 - コンテナ数（通し番号）（中央寄せ）
        sequence = label.get('sequence', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, sequence, font_name, 40, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q2_center_x = x + self.LABEL_WIDTH - q_width / 2  # Q2の中央X座標
        q2_center_y = y + self.LABEL_HEIGHT - q_height / 2  # Q2の中央Y座標
        c.drawString(q2_center_x - text_width / 2, q2_center_y - text_height / 2, sequence)
        
        # Q3: 左下 - 品目（中央寄せ）
        item = label.get('item', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, item, font_name, 50, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q3_center_x = x + q_width / 2  # Q3の中央X座標
        q3_center_y = y + q_height / 2  # Q3の中央Y座標
        c.drawString(q3_center_x - text_width / 2, q3_center_y - text_height / 2, item)
        
        # Q4: 右下 - 入り数（中央寄せ）
        quantity = label.get('quantity', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, quantity, font_name, 30, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q4_center_x = x + self.LABEL_WIDTH - q_width / 2  # Q4の中央X座標
        q4_center_y = y + q_height / 2  # Q4の中央Y座標
        c.drawString(q4_center_x - text_width / 2, q4_center_y - text_height / 2, quantity)
        
        # 出荷日（ラベル水平中央、大きめの文字）
        shipment_date = label.get('shipment_date', '')
        if shipment_date:
            center_x = x + self.LABEL_WIDTH / 2
            date_y = y + 12  # 下端から12pt上
            c.setFont(font_name, 16)
            c.drawCentredString(center_x, date_y, shipment_date)
    
    def _draw_fraction_label(self, c: canvas.Canvas, x: float, y: float, 
                            label: Dict, font_name: str):
        """端数ラベル（最後の1箱）を描画（4つの領域、Q4に超巨大フォント、下部に二重線、！ウォーターマーク）"""
        # 「！」ウォーターマークを背景に描画（とても薄い灰色）
        c.saveState()
        c.setFillColor(gray, alpha=0.08)  # 非常に薄い灰色
        c.setFont(font_name, 120)  # 大きなフォントサイズ
        exclamation_width = c.stringWidth('！', font_name, 120)
        exclamation_x = x + (self.LABEL_WIDTH - exclamation_width) / 2
        exclamation_y = y + (self.LABEL_HEIGHT - 120 * 0.7) / 2
        c.drawString(exclamation_x, exclamation_y, '！')
        c.restoreState()
        
        # 太い黒の破線枠（端数ラベル）
        c.setStrokeColor(black)
        c.setLineWidth(4)  # 太めの破線
        c.setDash([12, 6])  # 破線パターン（長めの破線）
        c.rect(x + 3, y + 3, self.LABEL_WIDTH - 6, self.LABEL_HEIGHT - 6, 
              stroke=1, fill=0)
        c.setDash()  # 破線をリセット
        
        # 下部に太い二重線を描画
        c.setStrokeColor(black)
        c.setLineWidth(2)
        line_y = y + self.LABEL_HEIGHT / 2  # 中央の横線
        c.line(x + 5, line_y, x + self.LABEL_WIDTH - 5, line_y)
        c.setLineWidth(1.5)
        c.line(x + 5, line_y - 1, x + self.LABEL_WIDTH - 5, line_y - 1)
        
        # テキスト色を黒に
        c.setFillColor(black)
        
        # 4つの領域のサイズ
        q_width = self.LABEL_WIDTH / 2  # 52.5mm
        q_height = self.LABEL_HEIGHT / 2  # 37.125mm
        
        # Q1: 左上 - 目的地（店舗名）を最大サイズ（中央寄せ）
        store = label.get('store', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, store, font_name, 50, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q1_center_x = x + q_width / 2  # Q1の中央X座標
        q1_center_y = y + self.LABEL_HEIGHT - q_height / 2  # Q1の中央Y座標
        c.drawString(q1_center_x - text_width / 2, q1_center_y - text_height / 2, store)
        
        # Q2: 右上 - コンテナ数（通し番号）（中央寄せ）
        sequence = label.get('sequence', '')
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, sequence, font_name, 40, q_width, q_height
        )
        c.setFont(font_name, font_size)
        q2_center_x = x + self.LABEL_WIDTH - q_width / 2  # Q2の中央X座標
        q2_center_y = y + self.LABEL_HEIGHT - q_height / 2  # Q2の中央Y座標
        c.drawString(q2_center_x - text_width / 2, q2_center_y - text_height / 2, sequence)
        
        # Q3: 左下 - 品目（Q4と重ならないように幅を制限、中央寄せ）
        item = label.get('item', '')
        # Q4が超巨大フォントになるため、Q3の幅を制限（Q4のスペースを確保）
        q3_max_width = q_width * 0.8  # Q3の最大幅を80%に制限
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, item, font_name, 50, q3_max_width, q_height
        )
        c.setFont(font_name, font_size)
        q3_center_x = x + q3_max_width / 2  # Q3の中央X座標（制限された幅内）
        q3_center_y = y + q_height / 2  # Q3の中央Y座標
        c.drawString(q3_center_x - text_width / 2, q3_center_y - text_height / 2, item)
        
        # Q4: 右下 - 数量を超巨大フォント（Q3と重ならないように、中央寄せ）
        quantity = label.get('quantity', '')
        # Q4を大幅に拡張（Q3の右側のスペースも使用）
        q4_extended_width = self.LABEL_WIDTH - q3_max_width - 10  # Q3の右側まで使用
        q4_extended_height = q_height
        font_size, text_width, text_height = self._draw_text_in_quadrant(
            c, quantity, font_name, 60, q4_extended_width, q4_extended_height
        )
        c.setFont(font_name, font_size)
        q4_center_x = x + q3_max_width + 10 + q4_extended_width / 2  # Q4の中央X座標（拡張領域内）
        q4_center_y = y + q_height / 2  # Q4の中央Y座標
        c.drawString(q4_center_x - text_width / 2, q4_center_y - text_height / 2, quantity)
        
        # 出荷日（ラベル最下段・水平中央、太字で視認性最大化）
        shipment_date = label.get('shipment_date', '')
        if shipment_date:
            center_x = x + self.LABEL_WIDTH / 2
            date_y = y + 5 * mm  # ラベル下端から5mm上にどっしり配置
            c.setFont(font_name, 22)
            c.drawCentredString(center_x, date_y, shipment_date)
    
    def _draw_guide_lines(self, c: canvas.Canvas, x: float, y: float, 
                         col: int, row: int, label_idx: int, total_labels: int, is_last_label: bool = False):
        """切断用ガイド線を描画（極めて薄いグレー、間隔の広い破線）"""
        c.setStrokeColor(gray, alpha=0.15)  # 極めて薄いグレー
        c.setLineWidth(0.3)
        c.setDash([20, 10])  # 間隔の広い破線
        
        # 右側の縦線（左列で、最後のラベルでない場合）
        if col == 0 and not is_last_label:
            c.line(x + self.LABEL_WIDTH, y, 
                  x + self.LABEL_WIDTH, y + self.LABEL_HEIGHT)
        
        # 下側の横線（最下段でない場合）
        if row < 3:
            c.line(x, y, x + self.LABEL_WIDTH, y)
        
        c.setDash()  # 破線をリセット
