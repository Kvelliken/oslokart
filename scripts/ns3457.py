"""Bygningstyper etter NS 3457 slik de brukes i matrikkelen, og grupperinger for kartet."""

NAVN = {
    111: "Enebolig", 112: "Enebolig med hybel", 113: "Våningshus", 121: "Tomannsbolig", 122: "Tomannsbolig",
    123: "Våningshus tomannsbolig", 124: "Våningshus tomannsbolig", 131: "Rekkehus", 133: "Kjedehus",
    135: "Terrassehus", 136: "Andre småhus", 141: "Store frittliggende boligbygg", 142: "Store frittliggende boligbygg",
    143: "Store frittliggende boligbygg", 144: "Store sammenbygde boligbygg", 145: "Store sammenbygde boligbygg",
    146: "Store sammenbygde boligbygg", 151: "Bo- og servicesenter", 152: "Studenthjem/studentboliger",
    159: "Annen bygning for bofellesskap", 161: "Fritidsbygning", 162: "Helårsbolig brukt som fritidsbolig",
    163: "Våningshus brukt som fritidsbolig", 171: "Seterhus, sel, rorbu o.l.", 172: "Skogs- og utmarkskoie, gamme",
    181: "Garasje, uthus, anneks til bolig", 182: "Garasje, uthus, anneks til fritidsbolig",
    183: "Naust, båthus, sjøbu", 193: "Boligbrakker", 199: "Annen boligbygning",
    211: "Fabrikkbygning", 212: "Verkstedbygning", 214: "Bygning for renseanlegg", 216: "Bygning for vannforsyning",
    219: "Annen industribygning", 221: "Kraftstasjon", 223: "Transformatorstasjon", 229: "Annen energiforsyningsbygning",
    231: "Lagerhall", 232: "Kjøle- og fryselager", 233: "Silobygning", 239: "Annen lagerbygning",
    241: "Hus for dyr, fôrlager, strølager", 243: "Veksthus", 244: "Driftsbygning for fiske og fangst",
    248: "Annen fiskeri- og fangstbygning", 249: "Annen landbruksbygning",
    311: "Kontor- og administrasjonsbygning", 312: "Bankbygning, posthus", 313: "Mediebygning",
    319: "Annen kontorbygning", 321: "Kjøpesenter, varehus", 322: "Butikkbygning", 323: "Bensinstasjon",
    329: "Annen forretningsbygning", 330: "Messe- og kongressbygning",
    411: "Ekspedisjonsbygning, flyterminal", 412: "Ekspedisjonsbygning, jernbane", 415: "Godsterminal",
    416: "Postterminal", 419: "Annen ekspedisjons- og terminalbygning", 429: "Telekommunikasjonsbygning",
    431: "Parkeringshus", 439: "Annen garasje- og hangarbygning", 441: "Trafikktilsynsbygning",
    449: "Annen veg- og trafikktilsynsbygning",
    511: "Hotellbygning", 512: "Motellbygning", 519: "Annen hotellbygning", 521: "Hospits, pensjonat",
    522: "Vandrerhjem", 523: "Appartement", 524: "Campinghytte/utleiehytte", 529: "Annen bygning for overnatting",
    531: "Restaurantbygning, kafébygning", 532: "Sentralkjøkken, kantinebygning", 533: "Gatekjøkken, kioskbygning",
    539: "Annen restaurantbygning",
    611: "Lekepark", 612: "Barnehage", 613: "Barneskole", 614: "Ungdomsskole", 615: "Kombinert barne- og ungdomsskole",
    616: "Videregående skole", 619: "Annen skolebygning", 621: "Universitets- og høgskolebygning",
    622: "Spesialskole", 623: "Laboratoriebygning", 629: "Annen universitets-/høgskole-/forskningsbygning",
    641: "Museum, kunstgalleri", 642: "Bibliotek, mediatek", 643: "Zoologisk og botanisk hage",
    649: "Annen museums- og bibliotekbygning", 651: "Idrettshall", 652: "Ishall", 653: "Svømmehall",
    654: "Tribune og idrettsgarderobe", 655: "Helsestudio", 659: "Annen idrettsbygning",
    661: "Kino-, teater-, opera-, konsertbygning", 662: "Samfunnshus, grendehus", 663: "Diskotek",
    669: "Annet kulturhus", 671: "Kirke, kapell", 672: "Bedehus, menighetshus", 673: "Krematorium, gravkapell",
    674: "Synagoge, moské", 675: "Kloster", 679: "Annen bygning for religiøse aktiviteter",
    719: "Sykehus", 721: "Sykehjem", 722: "Bo- og behandlingssenter", 723: "Rehabiliteringsinstitusjon",
    729: "Annet sykehjem", 731: "Klinikk, legekontor, helsesenter", 732: "Helse- og sosialsenter, helsestasjon",
    739: "Annen primærhelsebygning", 819: "Fengselsbygning", 821: "Politistasjon",
    822: "Brannstasjon, ambulansestasjon", 823: "Bygning for tilfluktsrom", 829: "Annen beredskapsbygning",
    830: "Monument", 840: "Offentlig toalett", 999: "Ukjent bygningstype",
}

GRUPPE = {1: "Bolig", 2: "Industri og lager", 3: "Kontor og forretning", 4: "Samferdsel",
          5: "Hotell og restaurant", 6: "Kultur og undervisning", 7: "Helse og omsorg", 8: "Fengsel og beredskap"}

SMAABYGG = {172, 181, 182, 183}


def navn(t):
    t = int(t)
    return NAVN.get(t) or GRUPPE.get(t // 100, "Annen bygning")


def hovedbruk(t):
    """Grovt formål for fargelegging av eiendommer."""
    t = int(t)
    if t == 612:
        return "barnehage"
    if 613 <= t <= 619 or t == 622:
        return "skole"
    if 651 <= t <= 659:
        return "idrett"
    if 641 <= t <= 649 or 661 <= t <= 679:
        return "kultur"
    if 700 <= t < 800:
        return "helse"
    if 819 <= t <= 829:
        return "beredskap"
    if t < 200:
        return "bolig"
    if t == 611 or t in (621, 623, 629):
        return "annet"
    return "naering"


def formal_punkt(t):
    """(hovedformål, underformål) for bygg som vises som punkt fra matrikkelen.

    Skoler og barnehager hentes fra Udir og idrett fra anleggsregisteret, så de er ikke med her.
    """
    t = int(t)
    if 721 <= t <= 729:
        return "helse", "Sykehjem og bo- og behandlingssenter"
    if 731 <= t <= 739:
        return "helse", "Helsesenter, legekontor, helsestasjon"
    if 700 <= t < 800:
        return "helse", "Annen helsebygning"
    if 641 <= t <= 649:
        return "kultur", "Museum og bibliotek"
    if 661 <= t <= 669:
        return "kultur", "Kulturhus, samfunnshus, scene"
    if 671 <= t <= 679:
        return "kultur", "Kirke og religiøse bygg"
    if t == 821:
        return "beredskap", "Politistasjon"
    if t == 822:
        return "beredskap", "Brann- og ambulansestasjon"
    if 819 <= t <= 829:
        return "beredskap", "Annen beredskapsbygning"
    return None
