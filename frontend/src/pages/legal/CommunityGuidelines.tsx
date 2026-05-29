import { Link } from "react-router-dom";

export default function CommunityGuidelines() {
  return (
    <div className="h-screen overflow-y-auto bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <div className="mb-6">
          <Link to="/auth/login" className="text-blue-600 hover:text-blue-800 text-sm">
            ← 返回登录
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">TAI AI 社区自律公约</h1>
        <div className="prose prose-gray max-w-none text-sm leading-relaxed">
          <h2 className="text-lg font-bold mt-6 mb-4">总则</h2>
          <p className="mb-4">
            TAI AI平台（以下简称"平台"）作为一款以"无限画布+智能节点"为核心的AI线上创作工具，整合文本、图像、视频、3D等多元模型交互能力，旨在为创意爱好者与专业创作者搭建健康和谐、开放包容、互助友爱的AI创作交流空间。我们深刻认识到，规范有序、平等正向的社区生态是保障用户创作权益、推动平台长远发展的核心基石，故依据国家相关法律法规及人工智能伦理治理要求，制定本《TAI AI社区自律公约》（以下简称"本公约"）。
          </p>
          <p className="mb-4">
            本公约是用户使用平台全部服务的核心指引与行为准则，覆盖平台客户端、网页端及所有相关衍生服务的全体注册用户。用户若违反本公约约定，平台将依据违规情节轻重、影响范围、主观恶意程度等因素，采取相应处置措施，包括但不限于删除或屏蔽违规内容、限制节点功能使用权限、对违规账号实施禁言、封禁等；若行为涉嫌违法犯罪，平台将立即终止提供相关服务，并积极配合执法及司法机关开展调查处置工作。同时，平台鼓励全体用户主动履行监督义务，对违规内容及行为及时举报，携手共建安全可控、正向繁荣的AI创作生态。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">平台倡导以下行为</h2>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-3">
              <strong>倡导构建平等友爱的TAI AI社区</strong>，尊重每一位创作者的创意成果与劳动付出。关爱未成年人群体，关照老年及新手创作者群体，坚守性别平等理念，包容多元文化；严禁攻击、谩骂、侮辱、诽谤、歧视他人，不得侵犯他人合法权益，共同营造温暖和谐的创作交流氛围。
            </li>
            <li className="mb-3">
              <strong>鼓励创作原创、优质的AI内容。</strong>建议用户合理运用Image Node、Midjourney Node等图像节点及视频、3D节点，通过科学的节点组合功能，创作画质清晰、构图完整、创意独特的作品；减少发布拼接网络素材、使用粗劣特效、无意义节点堆砌或内容空洞的低质作品。
            </li>
            <li className="mb-3">
              <strong>提倡真实表达创意理念与创作过程。</strong>禁止营造虚假创作人设，不得通过刻意夸大节点功能效果、伪造创作流程（如虚假节点连线展示）、伪原创等方式博人眼球、误导公众。
            </li>
            <li className="mb-3">
              <strong>规范使用文本及提示词相关功能。</strong>在Text Chat Node、Prompt Optimizer等文本节点操作中，应重视文字规范使用，避免错别字及歧义表达，减少不必要的拼音首字母缩写，精准传递创作需求，提升AI生成效果与社区交流效率。
            </li>
            <li className="mb-3">
              <strong>强化网络安全与隐私保护意识。</strong>对网络诈骗高发场景（如诱导付费代生成、虚假节点插件推广、返利中奖、网络兼职刷量等）保持高度警惕，不随意分享画布链接、节点配置文件及个人敏感信息（含身份证号、手机号、银行卡号等）。如发现异常情形，可通过平台官方渠道及时举报。
            </li>
            <li className="mb-3">
              <strong>鼓励制作、发布经合规校验且具备正向引导意义的内容</strong>，坚决做到不造谣、不传谣、不信谣。鼓励专业创作者分享节点组合技巧、模型应用经验、创意设计思路等专业知识，推动AI创作领域健康发展，积极将创作用于科学交流、教育共享、公益传播等增进人类福祉的场景。
            </li>
          </ol>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">平台禁止及不欢迎以下行为</h2>

          <h3 className="font-semibold mb-2">一、暴力与犯罪行为</h3>

          <h4 className="font-medium mb-2">1. 煽动与实施暴力</h4>
          <p className="mb-4">
            平台坚决反对任何形式的暴力行为，严禁用户利用图像、视频、3D等节点功能，煽动、宣扬或美化暴力行为，禁止制作、发布、传播展示人身伤害、财产破坏、社会秩序混乱等场景的内容，包括但不限于通过Video Node生成暴力画面、借助3D Node构建暴力场景模型等违规行为。
          </p>

          <h4 className="font-medium mb-2">2. 违禁与管制物品</h4>
          <p className="mb-4">
            为营造安全有序的创作社区环境，严格遵守国家法律法规，禁止用户以任何形式利用平台节点功能制作、发布、传播违禁品和管制物品相关内容（新闻媒体依法公开报道除外）。严禁通过Image Node生成枪支弹药、爆炸物、管制器具等图像，或通过视频节点制作违禁物品展示、交易相关视频。本条款所指违禁与管制物品，包括但不限于枪支弹药、爆炸物、管制器具、剧毒物品、放射性物品等国家明令禁止的物品。
          </p>

          <hr className="my-6" />

          <h3 className="font-semibold mb-2">二、时政有害及不实信息</h3>
          <p className="mb-4">
            国家安全与国家形象关乎每个公民的合法权益，平台严禁用户利用平台节点功能制作、发布违反法律法规、危害国家安全、损害国家尊严与形象的时政有害及不实信息。时政类信息涵盖政治、经济、军事、外交等社会公共事务及社会突发事件相关信息，平台将依据法律法规及主管部门要求依法开展治理工作。
          </p>
          <p className="mb-4">
            用户通过节点功能制作、发布涉及国内外时事、公共政策、社会事件的内容时，若为自行AI生成，需明确标注生成时间及所用核心节点；若引用他人内容，需注明引用来源及出处，助力其他用户准确判断内容真实性与时效性。
          </p>

          <h4 className="font-medium mb-2">1. 时政有害信息</h4>
          <p className="mb-4">平台严禁制作、发布、传播含有下列危害国家及社会安全的时政有害信息：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-1">反对宪法确定的基本原则的；</li>
            <li className="mb-1">危害国家统一、主权和领土完整的；</li>
            <li className="mb-1">泄露国家秘密、危害国家安全或者损害国家荣誉和利益的；</li>
            <li className="mb-1">宣扬恐怖主义、极端主义或者煽动实施恐怖活动、极端主义活动的；</li>
            <li className="mb-1">煽动民族仇恨、民族歧视，破坏民族团结的；</li>
            <li className="mb-1">破坏国家宗教政策，宣扬邪教和封建迷信的；</li>
            <li className="mb-1">散布谣言，扰乱经济秩序和社会秩序的；</li>
            <li className="mb-1">散布淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的；</li>
            <li className="mb-1">煽动非法集会、结社、游行、示威、聚众扰乱社会秩序的；</li>
            <li className="mb-1">歪曲、丑化、亵渎、否定英雄烈士及其事迹、精神的；</li>
            <li className="mb-1">以贬损、玷污、篡改等方式，侮辱、恶搞、歪曲国旗、国歌、国徽、人民币、军旗等具有特殊含义的象征、标志的；</li>
            <li className="mb-1">含有法律法规禁止的其他内容的。</li>
          </ul>

          <hr className="my-6" />

          <h3 className="font-semibold mb-2">三、侵犯人身权益</h3>
          <p className="mb-4">
            平台严禁诽谤、曝光隐私、人肉搜索等侵犯他人人身权益的违法违规行为。
          </p>

          <h4 className="font-medium mb-2">1. 侵犯人身自由</h4>
          <p className="mb-4">
            严禁制作、发布、传播展示、宣扬、美化侵犯他人人身自由权利的内容，包括但不限于买卖人口、强迫劳动、买卖人体器官等相关图像、视频；此类行为涉嫌违法犯罪，平台将依法处置并积极配合司法机关开展调查处理工作。
          </p>

          <h4 className="font-medium mb-2">2. 危险行为</h4>
          <p className="mb-4">
            禁止制作、发布、传播危险行为相关内容，包括但不限于通过Seedance 1.5 Pro生成危险舞蹈动作视频、借助Video Node制作危险驾驶、危险恶作剧画面，或展示危险工具、危险玩具的AI生成内容，避免诱导他人模仿引发人身伤害事故。
          </p>

          <h4 className="font-medium mb-2">3. 侵犯隐私与个人信息</h4>
          <p className="mb-4">
            平台高度重视用户隐私保护，严格遵守个人信息保护相关法律法规，禁止在未经权利人许可且无法律依据的情况下，通过任何节点功能发布、曝光他人个人信息，包括但不限于利用Image Node生成含他人隐私信息的图像、通过文本节点泄露他人联系方式、住址、身份证号等敏感信息；禁止以任何形式索取他人隐私信息。
          </p>

          <h4 className="font-medium mb-2">4. 其他侵犯人身权益的行为</h4>
          <p className="mb-4">其他侵犯他人人身权益的行为包括但不限于：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-1">滥用、冒用他人肖像、姓名，通过图像、视频节点生成仿冒他人的内容，侵犯他人肖像权、姓名权；</li>
            <li className="mb-1">采用诽谤、诋毁手段，通过节点组合创作内容损害他人名誉、降低他人社会评价或产品服务口碑；</li>
            <li className="mb-1">雇佣、组织、教唆他人发布、转发侵害他人人身权益的AI生成内容。</li>
          </ul>

          <hr className="my-6" />

          <h3 className="font-semibold mb-2">四、违法与不良内容</h3>
          <p className="mb-4">
            我们鼓励创作积极向上、具有传播价值的AI作品，坚决抵制利用平台节点功能制作、发布、传播违法及不良内容及仇恨言论。禁止通过图像、视频节点生成带有歧视性特征的人物形象、场景画面，或利用文本节点发表煽动仇恨、挑起群体对立的言论，共同维护多元包容的创作环境。
          </p>

          <h4 className="font-medium mb-2">1. 低俗媚俗内容</h4>
          <p className="mb-4">
            平台倡导文明健康的创作导向，共同传递社会正能量。
          </p>
          <p className="mb-4">
            鉴于不同用户对血腥、惊悚、低俗等敏感内容的接受程度存在差异，尤其是未成年人用户的心智尚未成熟，除上述明确禁止的内容外，若创作内容中包含少量敏感元素，用户必须主动添加显著警示标识。
          </p>

          <h4 className="font-medium mb-2">2. 侵犯知识产权</h4>
          <p className="mb-4">
            若用户创作内容使用了他人授权素材，需在作品显著位置明确标注授权主体、授权范围及授权期限；禁止未经授权使用他人作品后冒充原创发布。
          </p>

          <h4 className="font-medium mb-2">3. 虚假宣传</h4>
          <p className="mb-4">
            禁止推广含有虚假宣传、夸大效果的产品或服务，如"一键生成爆款作品""AI节点破解版"等不实推广信息，需确保售后保障机制完善。
          </p>

          <h4 className="font-medium mb-2">4. 恶意刷量与数据造假</h4>
          <p className="mb-4">
            禁止通过雇佣水军、使用作弊工具、操控账号矩阵等方式，对AI创作内容进行恶意刷量与数据造假。
          </p>

          <h4 className="font-medium mb-2">5. 干扰平台运行</h4>
          <p className="mb-4">
            禁止使用第三方插件、脚本，干扰平台正常运行秩序；利用节点功能生成垃圾内容、重复内容，污染社区内容环境；故意规避平台审核机制。
          </p>

          <h4 className="font-medium mb-2">6. 轻微违规情形</h4>
          <p className="mb-4">
            轻微违规情形包括：内容存在少量错别字、轻微低俗表述，首次发布低质无意义内容，违规使用文本缩写影响正常交流等情形。平台将根据违规情节采取相应处置措施，并通过平台消息通知用户。若复核确认原处置有误，平台将立即撤销相关处置措施，恢复账号正常功能。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">附则</h2>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-3">
              本公约依据国家现行法律法规及人工智能伦理治理相关要求制定，若后续相关法律法规、政策及行业规范发生调整，本公约将随之修订完善。修订后的公约将通过平台官网、客户端公告等方式进行公示，公示之日起7日后正式生效。
            </li>
            <li className="mb-3">
              本公约未尽事宜，参照 TAI 用户服务与 AI 使用协议及平台其他专项规则执行，平台拥有对本公约的最终解释权。
            </li>
            <li className="mb-3">
              本公约自发布之日起正式生效，适用于平台全体注册用户及所有服务场景。用户继续使用平台服务，即视为已充分阅读、理解并同意遵守本公约全部约定。
            </li>
          </ol>

          <div className="bg-gray-50 p-4 rounded-lg mb-4 mt-6">
            <p className="mb-1"><strong>TAI AI平台运营团队</strong></p>
          </div>

          <p className="text-gray-500 text-sm mt-6">
            最终解释权归天宫子午（深圳）科技有限公司所有
          </p>
        </div>
      </div>
    </div>
  );
}
