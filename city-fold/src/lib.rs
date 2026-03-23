use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::WebGlRenderingContext as GL;
use std::cell::RefCell;
use std::rc::Rc;

mod math;
mod renderer;
mod game;

use game::Game;

thread_local! {
    static GAME: RefCell<Option<Rc<RefCell<Game>>>> = RefCell::new(None);
}

#[wasm_bindgen]
pub fn load_level(level: usize) {
    GAME.with(|g| {
        if let Some(game) = g.borrow().as_ref() {
            game.borrow_mut().load_level(level);
        }
    });
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    let window = web_sys::window().unwrap();
    let document = window.document().unwrap();
    let canvas = document
        .get_element_by_id("canvas")
        .unwrap()
        .dyn_into::<web_sys::HtmlCanvasElement>()?;

    let gl = canvas
        .get_context("webgl")?
        .unwrap()
        .dyn_into::<GL>()?;

    let game = Rc::new(RefCell::new(Game::new(gl, canvas)?));

    // Store in global
    GAME.with(|g| {
        *g.borrow_mut() = Some(game.clone());
    });

    // Setup event listeners
    {
        let game_clone = game.clone();
        let closure = Closure::wrap(Box::new(move |event: web_sys::MouseEvent| {
            game_clone.borrow_mut().on_mouse_move(event);
        }) as Box<dyn FnMut(_)>);
        window.add_event_listener_with_callback("mousemove", closure.as_ref().unchecked_ref())?;
        closure.forget();
    }

    {
        let game_clone = game.clone();
        let closure = Closure::wrap(Box::new(move |event: web_sys::MouseEvent| {
            game_clone.borrow_mut().on_mouse_down(event);
        }) as Box<dyn FnMut(_)>);
        window.add_event_listener_with_callback("mousedown", closure.as_ref().unchecked_ref())?;
        closure.forget();
    }

    {
        let game_clone = game.clone();
        let closure = Closure::wrap(Box::new(move |event: web_sys::MouseEvent| {
            game_clone.borrow_mut().on_mouse_up(event);
        }) as Box<dyn FnMut(_)>);
        window.add_event_listener_with_callback("mouseup", closure.as_ref().unchecked_ref())?;
        closure.forget();
    }

    {
        let game_clone = game.clone();
        let closure = Closure::wrap(Box::new(move |event: web_sys::WheelEvent| {
            game_clone.borrow_mut().on_wheel(event);
        }) as Box<dyn FnMut(_)>);
        window.add_event_listener_with_callback("wheel", closure.as_ref().unchecked_ref())?;
        closure.forget();
    }

    {
        let game_clone = game.clone();
        let closure = Closure::wrap(Box::new(move |event: web_sys::KeyboardEvent| {
            game_clone.borrow_mut().on_key_down(event);
        }) as Box<dyn FnMut(_)>);
        window.add_event_listener_with_callback("keydown", closure.as_ref().unchecked_ref())?;
        closure.forget();
    }

    // Animation loop
    let f = Rc::new(RefCell::new(None::<Closure<dyn FnMut(f64)>>));
    let g = f.clone();
    let game_loop = game.clone();

    *g.borrow_mut() = Some(Closure::wrap(Box::new(move |timestamp: f64| {
        game_loop.borrow_mut().update(timestamp);
        game_loop.borrow().render();

        let window = web_sys::window().unwrap();
        window
            .request_animation_frame(
                f.borrow().as_ref().unwrap().as_ref().unchecked_ref(),
            )
            .unwrap();
    }) as Box<dyn FnMut(f64)>));

    window
        .request_animation_frame(g.borrow().as_ref().unwrap().as_ref().unchecked_ref())?;

    Ok(())
}
