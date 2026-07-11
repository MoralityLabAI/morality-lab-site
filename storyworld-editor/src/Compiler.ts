export class Compiler {
    output: string = "";
    ifid: string = "";

    constructor(game_data: string, storyworld_title: string, storyworld_author: string, ifid: string, template: string) {
        this.output = template;
        if (storyworld_title !== "") {
            this.output = this.output.replace("<title>SweepWeave Storyworld Interpreter</title>", "<title>" + storyworld_title + "</title>");
        }
        if (storyworld_author !== "") {
            this.output = this.output.replace('<meta name="author" content="Anonymous">', '<meta name="author" content="' + storyworld_author + '">');
        }
        if (ifid !== "") {
            this.output = this.output.replace('<meta prefix="ifiction: http://babel.ifarchive.org/protocol/iFiction/" property="ifiction:ifid" content="">', '<meta prefix="ifiction: http://babel.ifarchive.org/protocol/iFiction/" property="ifiction:ifid" content="' + ifid + '">');
        }
        this.output = this.output.replace('<script type="text/javascript" src="storyworld_data.js"></script>', "<script>" + game_data.replace(/\\n/g, "<br>\\n") + "</script>");
    }
}
