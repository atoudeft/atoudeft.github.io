fetch("menu.html")
    .then(stream => stream.text())
    .then(text => define(text));

function define(html) {
    class Menu extends HTMLElement {
        set value(value) {
            this._value = value;
            this.valueElement.innerText = this._value;
        }

        get value() {
            return this._value;
        }

        constructor() {
            super();
            this._value = 0;

            var shadow = this.attachShadow({mode: 'open'});
            shadow.innerHTML = html;

            /*this.valueElement = shadow.querySelector('p');
            var incrementButton = shadow.querySelectorAll('button')[1];
            var decrementButton = shadow.querySelectorAll('button')[0];

            incrementButton.onclick = () => this.value++;
            decrementButton.onclick = () => this.value--;*/
        }
    }

    customElements.define('mon-menu', Menu);
}