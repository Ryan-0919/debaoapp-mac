import 'package:flutter/material.dart';

import '../../core/design_tokens.dart';
import '../../data/models.dart';
import 'learning_card_reader.dart';

/// A task's ordered materials. Each uploaded asset is one swipeable card.
class LearningCardDeck extends StatefulWidget {
  const LearningCardDeck(
      {super.key,
      required this.card,
      required this.onComplete,
      this.onRatingsChanged,
      this.busy = false,
      this.error});
  final LearningCard card;
  final VoidCallback onComplete;
  final ValueChanged<Map<int, String>>? onRatingsChanged;
  final bool busy;
  final String? error;

  @override
  State<LearningCardDeck> createState() => _LearningCardDeckState();
}

class _LearningCardDeckState extends State<LearningCardDeck> {
  final controller = PageController(viewportFraction: .92);
  final completed = <int>{};
  final revealed = <int>{};
  final ratings = <int, String>{};
  final readPages = <int>{};
  final ready = <int>{};
  int index = 0;
  int phase = 0;
  int retry = 0;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void move(int next) {
    controller.animateToPage(next,
        duration: MediaQuery.of(context).disableAnimations
            ? Duration.zero
            : const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic);
  }

  void markReady(int page) {
    if (ready.contains(page)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && ready.add(page)) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final assetCount = widget.card.assets.length;
    final count = phase == 1
        ? widget.card.recallItems.length
        : phase == 2
            ? 1
            : assetCount;
    if (count == 0) return const Center(child: Text('暂未配置卡片，请联系老师'));
    final recallCount = widget.card.recallItems.length;
    final allRead = readPages.length == assetCount;
    final allDone = recallCount == 0
        ? readPages.length == assetCount
        : completed.length == recallCount;
    final canMark = phase == 0
        ? (ready.contains(index) || widget.card.assets[index].type == 'text')
        : true;
    return ColoredBox(
        color: DebaoColors.page,
        child: SafeArea(
          top: false,
          child: Column(children: [
            Padding(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.card.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 20,
                              height: 1.4,
                              fontWeight: FontWeight.w700,
                              color: DebaoColors.ink)),
                      const SizedBox(height: 10),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('第 ${index + 1} / $count 张',
                                key: const ValueKey('card-deck-position'),
                                style: const TextStyle(
                                    color: DebaoColors.brand,
                                    fontWeight: FontWeight.w600)),
                            Text('已背诵 ${readPages.length} 张',
                                style:
                                    const TextStyle(color: DebaoColors.body)),
                          ]),
                      const SizedBox(height: 10),
                      ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                              value: phase == 1
                                  ? completed.length / count
                                  : readPages.length / assetCount,
                              minHeight: 4,
                              backgroundColor: DebaoColors.line,
                              color: DebaoColors.brand)),
                    ])),
            Expanded(
                child: PageView.builder(
              key: const ValueKey('card-deck-pages'),
              controller: controller,
              scrollDirection: Axis.vertical,
              itemCount: count,
              onPageChanged: (value) => setState(() => index = value),
              itemBuilder: (context, page) => Padding(
                padding: const EdgeInsets.fromLTRB(6, 8, 6, 14),
                child: Container(
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: const [
                          BoxShadow(
                              color: Color(0x0D171925),
                              blurRadius: 12,
                              offset: Offset(0, 4))
                        ]),
                    child: phase == 1 && recallCount > 0
                        ? _recallContent(page)
                        : phase == 2
                            ? _summaryContent()
                            : _content(page)),
              ),
            )),
            Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(children: [
                  IconButton(
                      tooltip: '上一张',
                      onPressed: index > 0 ? () => move(index - 1) : null,
                      icon: const Icon(Icons.keyboard_arrow_up)),
                  Expanded(
                      child: Text(count > 1 ? '上下滑动切换 · 点击内容可缩放' : '读完后确认背诵',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: DebaoColors.body, fontSize: 12))),
                  IconButton(
                      tooltip: '下一张',
                      onPressed:
                          index + 1 < count ? () => move(index + 1) : null,
                      icon: const Icon(Icons.keyboard_arrow_down)),
                ])),
            Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (phase == 0 && !canMark)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                            widget.card.assets[index].type == 'html'
                                ? '请先打开卡片阅读，完成后返回即可确认背诵'
                                : '素材加载完成后可确认背诵；加载失败请点击重新加载',
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 12)),
                      ),
                    if (widget.error != null)
                      Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(widget.error!,
                              style: const TextStyle(color: Colors.red))),
                    SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: FilledButton.icon(
                          key: const ValueKey('courses-card-complete'),
                          onPressed: widget.busy
                              ? null
                              : phase == 0
                                  ? allRead
                                      ? () {
                                          if (recallCount == 0) {
                                            widget.onComplete();
                                            return;
                                          }
                                          controller.jumpToPage(0);
                                          setState(() {
                                            phase = recallCount > 0 ? 1 : 2;
                                            index = 0;
                                            completed.clear();
                                          });
                                        }
                                      : canMark
                                          ? () {
                                              setState(
                                                  () => readPages.add(index));
                                              if (readPages.length < count)
                                                move(List.generate(
                                                    count,
                                                    (i) =>
                                                        i).firstWhere((i) =>
                                                    !readPages.contains(i)));
                                            }
                                          : null
                                  : phase == 1
                                      ? allDone
                                          ? () {
                                              controller.jumpToPage(0);
                                              setState(() {
                                                phase = 2;
                                                index = 0;
                                              });
                                            }
                                          : revealed.contains(index) &&
                                                  !ratings.containsKey(index)
                                              ? null
                                              : () {
                                                  if (!revealed
                                                      .contains(index)) {
                                                    setState(() =>
                                                        revealed.add(index));
                                                    return;
                                                  }
                                                  setState(() =>
                                                      completed.add(index));
                                                  if (completed.length <
                                                      recallCount)
                                                    move(List.generate(
                                                            recallCount,
                                                            (i) => i)
                                                        .firstWhere((i) =>
                                                            !completed
                                                                .contains(i)));
                                                }
                                      : widget.onComplete,
                          style: FilledButton.styleFrom(
                              backgroundColor: DebaoColors.brand,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12))),
                          icon: widget.busy
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : Icon(
                                  allDone
                                      ? Icons.lock_open_outlined
                                      : Icons.check,
                                  size: 20),
                          label: Text(widget.busy
                              ? '正在提交…'
                              : phase == 0
                                  ? allRead
                                      ? recallCount > 0
                                          ? '开始主动回忆'
                                          : '完成背诵并解锁题目'
                                      : '本张已背诵'
                                  : phase == 1
                                      ? allDone
                                          ? '完成背诵并解锁题目'
                                          : revealed.contains(index)
                                              ? '核对完成，下一张'
                                              : '查看答案'
                                      : '完成背诵并解锁题目'),
                        )),
                  ],
                )),
          ]),
        ));
  }

  Widget _recallContent(int page) {
    final item = widget.card.recallItems[page];
    final shown = revealed.contains(page);
    return SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('主动回忆 · 挖空',
              style: TextStyle(
                  color: DebaoColors.brand, fontWeight: FontWeight.w700)),
          const SizedBox(height: 28),
          Text(
              shown
                  ? item.prompt.replaceFirst('____', item.answer)
                  : item.prompt,
              style: const TextStyle(
                  fontSize: 23,
                  height: 1.7,
                  fontWeight: FontWeight.w700,
                  color: DebaoColors.ink)),
          const SizedBox(height: 32),
          Text(shown ? '答案：${item.answer}' : '先回忆空白处，再点击下方核对答案',
              style: const TextStyle(
                  fontSize: 15, height: 1.6, color: DebaoColors.body)),
          if (shown) ...[
            const SizedBox(height: 24),
            const Text('这次回忆得怎么样？'),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final option in const {
                'remembered': '记住了',
                'uncertain': '不熟悉',
                'forgotten': '没记住'
              }.entries)
                ChoiceChip(
                    label: Text(option.value),
                    selected: ratings[page] == option.key,
                    onSelected: widget.busy
                        ? null
                        : (_) {
                            setState(() => ratings[page] = option.key);
                            widget.onRatingsChanged?.call(Map.of(ratings));
                          }),
            ]),
          ],
        ]));
  }

  Widget _summaryContent() => Padding(
      padding: const EdgeInsets.all(28),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.verified_outlined,
            color: DebaoColors.success, size: 48),
        const SizedBox(height: 22),
        const Text('主动回忆完成',
            style: TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w700,
                color: DebaoColors.ink)),
        const SizedBox(height: 14),
        Text('已完成 ${widget.card.recallItems.length} 个挖空，接下来可以进入配套题目。',
            style: const TextStyle(
                fontSize: 16, height: 1.7, color: DebaoColors.body)),
      ]));

  Widget _content(int page) {
    final asset = widget.card.assets[page];
    if (asset.type == 'text')
      return Column(children: [
        Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
                onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => _CardZoomPage(
                            title: asset.filename ?? widget.card.title,
                            child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: SelectableText(asset.reference,
                                    style: const TextStyle(
                                        fontSize: 18, height: 1.8)))))),
                icon: const Icon(Icons.zoom_in),
                label: const Text('放大阅读'))),
        Expanded(
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(26),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(asset.filename ?? widget.card.title,
                          style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w700,
                              height: 1.4)),
                      const SizedBox(height: 24),
                      SelectableText(asset.reference,
                          style: const TextStyle(
                              fontSize: 18,
                              height: 1.8,
                              color: DebaoColors.body)),
                    ]))),
      ]);
    if (asset.type == 'html' || asset.type == 'pdf')
      return Center(
          child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(
                    asset.type == 'pdf'
                        ? Icons.picture_as_pdf_outlined
                        : Icons.article_outlined,
                    size: 40,
                    color: DebaoColors.brand),
                const SizedBox(height: 20),
                Text(asset.filename ?? widget.card.title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                Text(
                    asset.type == 'pdf'
                        ? '打开 PDF 内容，阅读后返回确认背诵。'
                        : '打开完整内容，阅读后返回确认背诵。',
                    textAlign: TextAlign.center),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () async {
                    final read = await Navigator.push<bool>(
                        context,
                        MaterialPageRoute(
                            builder: (_) => LearningHtmlReader(
                                reference: asset.reference,
                                isPdf: asset.type == 'pdf')));
                    if (mounted && read == true)
                      setState(() => ready.add(page));
                  },
                  child: Text(ready.contains(page)
                      ? (asset.type == 'pdf' ? '重新阅读 PDF 卡片' : '重新阅读 HTML 卡片')
                      : (asset.type == 'pdf' ? '阅读 PDF 卡片' : '阅读 HTML 卡片')),
                )
              ])));
    if (asset.type != 'image')
      return const Center(child: Text('暂不支持此素材类型，请联系老师'));
    String url;
    try {
      url = learningAssetUri(asset.reference).toString();
    } catch (_) {
      return const Center(child: Text('图片地址无效，请联系老师'));
    }
    return InkWell(
        onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => _CardZoomPage(
                      title: '第 ${page + 1} 张',
                      child: Image.network(url,
                          errorBuilder: (_, __, ___) =>
                              const Text('图片加载失败，请返回重试')),
                    ))),
        child: Column(children: [
          const Padding(
              padding: EdgeInsets.all(12),
              child: Text('点击图片可放大查看',
                  style: TextStyle(fontSize: 12, color: DebaoColors.body))),
          Expanded(
              child: Image.network(
            url,
            key: ValueKey('$url-$retry'),
            fit: BoxFit.contain,
            frameBuilder: (context, child, frame, synchronous) {
              if (frame != null || synchronous) {
                markReady(page);
                return child;
              }
              return const Center(child: CircularProgressIndicator());
            },
            errorBuilder: (_, __, ___) => Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('图片加载失败'),
              TextButton(
                  onPressed: () async {
                    await NetworkImage(url).evict();
                    if (mounted) setState(() => retry++);
                  },
                  child: const Text('重新加载')),
            ])),
          )),
          const SizedBox(height: 16),
        ]));
  }
}

/// A separate reader keeps zoom/pan gestures from swallowing vertical paging.
class _CardZoomPage extends StatefulWidget {
  const _CardZoomPage({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  State<_CardZoomPage> createState() => _CardZoomPageState();
}

class _CardZoomPageState extends State<_CardZoomPage> {
  final transform = TransformationController();
  @override
  void dispose() {
    transform.dispose();
    super.dispose();
  }

  void zoom(double factor) {
    final old = transform.value.getMaxScaleOnAxis();
    final scale = (old * factor).clamp(.5, 5.0);
    final center = transform.toScene(viewport.center(Offset.zero));
    setState(() => transform.value = Matrix4.identity()
      ..translateByDouble(viewport.width / 2 - center.dx * scale,
          viewport.height / 2 - center.dy * scale, 0, 1)
      ..scaleByDouble(scale, scale, 1, 1));
  }

  Size viewport = Size.zero;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title), actions: [
          IconButton(
              key: const ValueKey('card-zoom-out'),
              tooltip: '缩小',
              onPressed: () => zoom(1 / 1.25),
              icon: const Icon(Icons.zoom_out)),
          TextButton(
              onPressed: () =>
                  setState(() => transform.value = Matrix4.identity()),
              child: const Text('还原')),
          IconButton(
              key: const ValueKey('card-zoom-in'),
              tooltip: '放大',
              onPressed: () => zoom(1.25),
              icon: const Icon(Icons.zoom_in)),
        ]),
        body: LayoutBuilder(builder: (context, constraints) {
          viewport = constraints.biggest;
          return InteractiveViewer(
            transformationController: transform,
            minScale: .5,
            maxScale: 5,
            boundaryMargin: const EdgeInsets.all(300),
            child: SizedBox(
                width: viewport.width,
                height: viewport.height,
                child:
                    Center(child: SingleChildScrollView(child: widget.child))),
          );
        }),
      );
}
