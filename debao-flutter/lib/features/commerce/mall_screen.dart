import '../../core/config/app_environment.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers.dart';
import '../../data/models.dart';
import '../../shared/route_back_button.dart';
import 'commerce_detail_screens.dart';

const _brand = Color(0xFF4C4BEA);
const _page = Color(0xFFF4F5F7);
const _ink = Color(0xFF171925);
const _muted = Color(0xFF707684);
const _line = Color(0xFFE5E7ED);

class MallScreen extends StatelessWidget {
  const MallScreen({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.showBackButton = false,
  });
  final bool remoteEnabled;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) =>
      ProviderScope(
          child: _MallScreenBody(
              remoteEnabled: remoteEnabled, showBackButton: showBackButton));
}

class _MallScreenBody extends ConsumerStatefulWidget {
  const _MallScreenBody(
      {required this.remoteEnabled, required this.showBackButton});
  final bool remoteEnabled;
  final bool showBackButton;
  @override
  ConsumerState<_MallScreenBody> createState() => _MallScreenState();
}

class _MallScreenState extends ConsumerState<_MallScreenBody> {
  String category = '全部';
  String type = '全部';

  @override
  Widget build(BuildContext context) {
    final remote = widget.remoteEnabled
        ? ref.watch(productsProvider)
        : const AsyncValue<List<Product>>.data([]);
    if (widget.remoteEnabled && remote.isLoading && !remote.hasValue) {
      return _statusScaffold(const Center(
          child: CircularProgressIndicator(key: ValueKey('mall-loading'))));
    }
    if (widget.remoteEnabled && remote.hasError && !remote.hasValue) {
      return _statusScaffold(_remoteError(remote.error!));
    }
    final source = widget.remoteEnabled
        ? (remote.valueOrNull ?? const <Product>[])
            .map(_fromModel)
            .toList(growable: false)
        : _products;
    final filtered = source
        .where((product) =>
            product.type != '直播课程' &&
            (category == '全部' || product.category == category) &&
            (type == '全部' || product.type == type))
        .toList();
    return Scaffold(
      backgroundColor: _page,
      appBar: AppBar(
          leading: widget.showBackButton
              ? const DebaoRouteBackButton(fallbackLocation: '/?tab=profile')
              : null,
          title: const Text('商城'),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white),
      body: Column(children: [
        if (widget.remoteEnabled && remote.hasError)
          MaterialBanner(
            content: const Text('服务暂不可用，当前保留已加载商品'),
            leading: const Icon(Icons.cloud_off_outlined),
            actions: [
              TextButton(
                  onPressed: () => ref.invalidate(productsProvider),
                  child: const Text('重试')),
            ],
          ),
        Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Container(
                height: 38,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                    color: _page, borderRadius: BorderRadius.circular(8)),
                child: const Row(children: [
                  Icon(Icons.search, size: 18, color: _muted),
                  SizedBox(width: 8),
                  Text('搜索课程、书籍…',
                      style: TextStyle(color: Color(0xFFC0C5D0), fontSize: 13))
                ]))),
        Container(
            decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(bottom: BorderSide(color: _line))),
            child: Column(children: [
              _FilterRow(
                  items: const ['全部', '主客一体', '客观题', '主观题'],
                  selected: category,
                  selectedStyle: _FilterStyle.underline,
                  onChanged: (value) => setState(() => category = value)),
              _FilterRow(
                  items: const ['全部', '视频课程', '音频课程', '书籍'],
                  selected: type,
                  selectedStyle: _FilterStyle.pill,
                  onChanged: (value) => setState(() => type = value))
            ])),
        Expanded(
            child: filtered.isEmpty
                ? const Center(
                    child: Text('暂无符合条件的课程', style: TextStyle(color: _muted)))
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, index) => _ProductCard(
                        product: filtered[index],
                        remoteEnabled: widget.remoteEnabled))),
      ]),
    );
  }

  Widget _statusScaffold(Widget body) => Scaffold(
        backgroundColor: _page,
        appBar: AppBar(
            title: const Text('商城'),
            backgroundColor: Colors.white,
            surfaceTintColor: Colors.white),
        body: body,
      );

  Widget _remoteError(Object error) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, color: _muted, size: 32),
            const SizedBox(height: 10),
            const Text('商品服务暂时不可用',
                style: TextStyle(
                    color: _ink, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text('$error',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _muted, fontSize: 11)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
                key: const ValueKey('mall-retry'),
                onPressed: () => ref.invalidate(productsProvider),
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('重试')),
          ]),
        ),
      );

  _Product _fromModel(Product product) => _Product(
        product.name,
        _productCategory(product),
        _productType(product),
        product.price.toString(),
        (product.originalPrice ?? product.price).toString(),
        product.sold.toString(),
        product.benefits.isEmpty ? '暂无商品简介' : product.benefits.first,
        _color(product.accent),
        Icons.menu_book_outlined,
        _productImage(product.name),
        id: product.id,
      );

  String _productCategory(Product product) {
    final raw = product.category.trim();
    if (raw == '全程备考' || raw == '全程班' || raw.contains('主客')) {
      return '主客一体';
    }
    if (raw == '音频课' || raw == '音频课程') {
      return '客观题';
    }
    if (raw == '视频课' || raw == '视频课程') {
      return product.name.contains('主观') ? '主观题' : '客观题';
    }
    if (raw.isEmpty) {
      return '未分类';
    }
    return raw;
  }

  String _productType(Product product) {
    final raw = product.type?.trim().toLowerCase() ?? '';
    if (raw.contains('音频') || raw == 'audio') return '音频课程';
    if (raw.contains('直播') || raw == 'live') return '直播课程';
    if (raw.contains('书')) return '书籍';
    if (raw.contains('视频') || raw == 'video') return '视频课程';
    final name = product.name;
    if (name.contains('音频')) return '音频课程';
    if (name.contains('直播')) return '直播课程';
    if (name.contains('书')) return '书籍';
    return '未分类';
  }

  String _productImage(String name) {
    if (name.contains('音频')) return 'assets/images/product-audio-all.png';
    if (name.contains('主观')) return 'assets/images/course-subjective.jpg';
    if (name.contains('刑法')) return 'assets/images/course-criminal-law.png';
    if (name.contains('直播')) return 'assets/images/product-live.png';
    return 'assets/images/course-civil-law.jpg';
  }

  Color _color(String? value) {
    if (value == null) return _brand;
    final hex = value.replaceFirst('#', '');
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? _brand : Color(0xFF000000 | parsed);
  }
}

enum _FilterStyle { underline, pill }

class _FilterRow extends StatelessWidget {
  const _FilterRow(
      {required this.items,
      required this.selected,
      required this.selectedStyle,
      required this.onChanged});
  final List<String> items;
  final String selected;
  final _FilterStyle selectedStyle;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: selectedStyle == _FilterStyle.underline ? 42 : 40,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, index) {
          final value = items[index];
          final isSelected = value == selected;
          return InkWell(
            onTap: () => onChanged(value),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: selectedStyle == _FilterStyle.pill
                  ? BoxDecoration(
                      color: isSelected ? _brand : Colors.white,
                      border: Border.all(color: isSelected ? _brand : _line),
                      borderRadius: BorderRadius.circular(15),
                    )
                  : BoxDecoration(
                      border: Border(
                        bottom: BorderSide(
                          color: isSelected ? _brand : Colors.transparent,
                          width: 2,
                        ),
                      ),
                    ),
              child: Text(
                value,
                style: TextStyle(
                  color: isSelected
                      ? (selectedStyle == _FilterStyle.pill
                          ? Colors.white
                          : _brand)
                      : _muted,
                  fontSize: selectedStyle == _FilterStyle.pill ? 12 : 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, this.remoteEnabled = remoteDataDefault});
  final _Product product;
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) {
    return InkWell(
        onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => ProductDetailScreen(
                    name: product.name,
                    brief: product.brief,
                    price: product.price,
                    originalPrice: product.originalPrice,
                    coverColor: product.coverColor,
                    icon: product.icon,
                    productId: product.id,
                    remoteEnabled: remoteEnabled))),
        borderRadius: BorderRadius.circular(8),
        child: Container(
            height: 116,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: remoteEnabled
                  ? SizedBox(width: 110, height: 80,
                      child: ColoredBox(color: product.coverColor,
                        child: Icon(product.icon, color: Colors.white, size: 30)))
                  : Image.asset(
                  product.image,
                  width: 110,
                  height: 80,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => ColoredBox(
                    color: product.coverColor,
                    child: SizedBox(
                        width: 110,
                        height: 80,
                        child: Center(
                            child: Icon(product.icon,
                                color: Colors.white, size: 30))),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Wrap(spacing: 5, children: [
                      _Tag(product.category, const Color(0xFFF0F0FF), _brand),
                      _Tag(product.type, const Color(0xFFF4F5F7), _muted)
                    ]),
                    const SizedBox(height: 6),
                    Text(product.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 13,
                            fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(product.brief,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: _muted, fontSize: 11)),
                    const Spacer(),
                    Row(children: [
                      Text('¥${product.price}',
                          style: const TextStyle(
                              color: _brand,
                              fontSize: 15,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(width: 6),
                      Text('¥${product.originalPrice}',
                          style: const TextStyle(
                              color: Color(0xFFC0C5D0),
                              fontSize: 11,
                              decoration: TextDecoration.lineThrough)),
                      const Spacer(),
                      Text('已售${product.sold}',
                          style: const TextStyle(color: _muted, fontSize: 11))
                    ])
                  ]))
            ])));
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.label, this.background, this.foreground);
  final String label;
  final Color background;
  final Color foreground;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
          color: background, borderRadius: BorderRadius.circular(4)),
      child: Text(label, style: TextStyle(color: foreground, fontSize: 10)));
}

class _Product {
  const _Product(
      this.name,
      this.category,
      this.type,
      this.price,
      this.originalPrice,
      this.sold,
      this.brief,
      this.coverColor,
      this.icon,
      this.image,
      {this.id});
  final String? id;
  final String name;
  final String category;
  final String type;
  final String price;
  final String originalPrice;
  final String sold;
  final String brief;
  final Color coverColor;
  final IconData icon;
  final String image;
}

const _products = <_Product>[
  _Product(
      '2024法考全程班（主客一体·视频精讲）',
      '主客一体',
      '视频课程',
      '3,980',
      '5,200',
      '2,847',
      '覆盖客观题全科+主观题冲刺，名师全程讲授，配套题库、模拟卷和主观题批改服务。',
      Color(0xFF4C4BEA),
      Icons.play_circle_fill,
      'assets/images/home-library.png',
      id: 'p1'),
  _Product(
      '2024客观题精英班（视频+直播）',
      '客观题',
      '视频课程',
      '1,980',
      '2,800',
      '5,312',
      '系统精讲客观题全科知识点，覆盖卷一卷二，配套章节练习和历年真题解析。',
      Color(0xFF1A5FA8),
      Icons.menu_book,
      'assets/images/home-office.png',
      id: 'p2'),
  _Product(
      '2024主观题冲刺班（精讲+批改）',
      '主观题',
      '视频课程',
      '1,280',
      '1,680',
      '1,893',
      '主观题专项突破，以历年真题案例为核心，精讲答题逻辑与规范，配套批改服务。',
      Color(0xFFD2691E),
      Icons.edit_note,
      'assets/images/course-subjective.jpg',
      id: 'p3'),
  _Product(
      '法考直播冲刺班（考前30天）',
      '客观题',
      '直播课程',
      '680',
      '880',
      '3,102',
      '考前30天密集直播冲刺，押题预测、重点串讲，配合模拟考试查漏补缺。',
      Color(0xFFC0385A),
      Icons.podcasts,
      'assets/images/product-live.png',
      id: 'p4'),
  _Product(
      '民法音频精讲（通勤随听版）',
      '客观题',
      '音频课程',
      '398',
      '598',
      '4,217',
      '全程音频授课，利用碎片时间随时随地听课，配套逐字稿与知识点卡片，通勤路上高效备考。',
      Color(0xFF1A8B8B),
      Icons.headphones,
      'assets/images/product-audio-civil.png',
      id: 'p5'),
  _Product(
      '法考全科音频串讲班',
      '主客一体',
      '音频课程',
      '880',
      '1,280',
      '2,091',
      '名师精讲全科核心考点，音频形式高效输出，配合题库随时检验，适合已有基础的二战考生。',
      Color(0xFF1A8B8B),
      Icons.headphones,
      'assets/images/product-audio-all.png',
      id: 'p6'),
];
