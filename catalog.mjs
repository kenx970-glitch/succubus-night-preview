export const PACKS = Object.freeze([
  {id:'s500',yen:500,coins:500}, {id:'s1500',yen:1500,coins:1500},
  {id:'s3000',yen:3000,coins:3000}, {id:'s5000',yen:5000,coins:5000}
]);
export const ITEMS = Object.freeze([
  {id:'drink',name:'キャストドリンク',priceG:1500,priceS:null,affection:3,reaction:'cheers',premium:false,benefits:['笑顔と乾杯の演出','キャスト専用の乾杯セリフ'],icon:'glass'},
  {id:'luxury',name:'月光のカクテル',priceG:4500,priceS:null,affection:6,reaction:'closeup',premium:false,benefits:['寄りのカメラ演出','特別な乾杯セリフ'],icon:'moon'},
  {id:'champagne',name:'星降るシャンパン',priceG:10000,priceS:null,affection:10,reaction:'champagne',premium:false,benefits:['照明ときらめきの演出','キャスト専用セリフ','購入日入り記念カードをアルバムに保存'],icon:'stars'},
  {id:'premium',name:'真夜中のプレミアムボトル',priceG:18000,priceS:null,affection:12,reaction:'premium',premium:true,benefits:['特別な背景・照明演出','記念カードをアルバムに保存','ボトル限定の短いエピソード（主要ストーリーは無料）'],icon:'crown'}
]);
export const CASTS = Object.freeze([
 {id:'luna',name:'ルナ',nameEn:'LUNA',age:27,position:'left',color:'#b28bcc',description:'静かな夜を、ゆっくりと。',personality:'やわらかく落ち着いていて、親しみやすいため口。星や本が好き。友達と話すように「そうなんだ」「いいね」と自然に相づちする。',greeting:'やっほー、ルナだよ。来てくれてうれしいな。今日はどんな日だった？'},
 {id:'mio',name:'ミオ',nameEn:'MIO',age:25,position:'center',color:'#e1aa84',description:'今日の小さな楽しみを、一緒に。',personality:'明るく可愛く、気さくなため口。音楽とカフェ巡りが好き。「ね、聞いて」「それいいね」と友達のように軽やかに話す。',greeting:'やっほー！ ミオだよ。ちょっと一緒にしゃべろ？ 今日なんかいいことあった？'},
 {id:'reina',name:'レイナ',nameEn:'REINA',age:29,position:'right',color:'#aabacb',description:'思い出に、もう一つの物語を。',personality:'少しお姉さんらしいけれど、堅苦しくない親しみやすいため口。旅と古い映画が好き。軽い冗談と柔らかな相づちを添える。',greeting:'こんばんは、レイナだよ。おつかれー。今日は忙しかった？ ここでちょっとひと休みしよ。'}
]);
export const TOPICS = Object.freeze([
 {id:'day',label:'今日の出来事',reply:'今日もおつかれー。なんか面白いことあった？ 小さいことでも聞きたいな。'},
 {id:'music',label:'好きな音楽',reply:'最近なに聴いてる？ おすすめあったら教えて。今の気分にぴったりの曲、見つけたいな。'},
 {id:'dream',label:'やってみたいこと',reply:'やってみたいことってある？ 大きな夢でも、ちょっと気になることでも聞かせて。'},
 {id:'memory',label:'前の思い出',reply:'ここで話したこと、少しずつ思い出になってくね。今日はどんな話しよっか？'}
]);
export const STORY_EVENTS = Object.freeze([
 {id:'introduction',title:'夜のはじまり',minLevel:1,episode:'街の明かりが落ち着く頃、この店は開きます。ルナ、ミオ、レイナ。三人はそれぞれ違う物語を持つ、架空のキャストです。'},
 {id:'regular',title:'いつもの席',minLevel:2,episode:'「今日はこの席にしましょうか」――窓際に、小さな月の形のカードが置かれています。何気ない会話が、店の新しい思い出になりました。'},
 {id:'behind',title:'閉店前の小さな秘密',minLevel:3,episode:'キャストが話してくれたのは、この店に来るまでの夢。舞台、本、遠い街。華やかな夜にも、静かに積み重ねた時間がありました。'},
 {id:'special',title:'星の降る夜',minLevel:4,episode:'三人が準備したのは、お金では買えない店の歴史をたどる小さな展示。昔の写真と、手書きの物語。あなたもその物語の読者になりました。'},
 {id:'anniversary',title:'夜明けのアルバム',minLevel:5,episode:'窓の向こうに、夜明けの色が広がります。これまで話した夢と音楽、店の秘密を一冊の物語にまとめました。また好きな時に、このページを開いてください。'}
]);
export const FICTION_NOTICE='キャストと好意度はフィクションです。AIが実際の恋愛感情を持つことはありません。';
const ORDER_LINES={
 luna:{drink:'ありがとう！ 一緒に乾杯しよ。今日の楽しかったこと、聞きたいな。',luxury:'この色、月明かりみたいできれいだね。今夜もゆっくり楽しも。乾杯。',champagne:'わあ、星が降る夜みたい。この景色を、記念の一枚に残そっか。乾杯。',premium:'昔ね、月の形を毎日ノートに描いてたんだ。同じ空でも、毎日ちょっと違うんだよ。ここで話す時間も、そんなふうに少しずつ思い出になってくといいな。'},
 mio:{drink:'ありがとう！ 今日の楽しかったことに、乾杯。',luxury:'このカクテル、夕焼けみたいな色だね。好きな曲を思い出しながら、乾杯しよう。',champagne:'きらきらしてる！ この夜の景色をアルバムに残そうね。乾杯！',premium:'小さい頃、空き箱を並べてカフェごっこをしてたんだ。メニューは全部、絵で描いて。今でも新しいドリンクを考えると、あの頃みたいにわくわくするよ。'},
 reina:{drink:'ありがとう！ 今日もおつかれー。一緒に乾杯しよ。',luxury:'この一杯、旅先で見た景色を思い出すな。ちょっと特別な気分だね。乾杯。',champagne:'わあ、きらきらしてる。思い出の一枚に、この時間を残そっか。乾杯。',premium:'旅先の小さな映画館で、昔の映画を観たことがあるんだ。言葉は全部わからなかったけど、窓から入る光がすごくきれいでさ。このお店でも、そういう思い出ができたらいいな。'}
};
export const orderLine=(castId,itemId)=>ORDER_LINES[castId]?.[itemId]||'ありがとう！ ゆっくり楽しんでね。';
export const LEVEL_NAMES=['初対面','常連客','仲良し','特別なお客様','大切な常連'];
export const levelFor = score => Math.min(5,1+Math.floor(Math.max(0,Math.min(100,score))/20));
